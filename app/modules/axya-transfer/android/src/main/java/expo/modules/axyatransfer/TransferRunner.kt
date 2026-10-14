package expo.modules.axyatransfer

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

internal class TransferHttpError(val code: Int, val payload: JSONObject) : Exception(payload.optString("message", payload.optString("error", "Transfer failed ($code)")))
internal class TransferStopped : Exception()

internal class TransferRunner(private val context: Context, private val owner: String, private val stopped: () -> Boolean, private val notify: (String, Int) -> Unit) {
  companion object { private val claims = java.util.concurrent.ConcurrentHashMap.newKeySet<String>() }
  private var activeConnection: HttpURLConnection? = null
  private var lastGuardAt=0L
  private val lastVisited = mutableMapOf<String, Long>()
  fun stop() { activeConnection?.disconnect(); DirectTelegram.close(owner) }
  private fun guard(id: String) {
    if(stopped())throw TransferStopped()
    val now=android.os.SystemClock.elapsedRealtime();if(now-lastGuardAt<250)return;lastGuardAt=now
    val task = TransferStore.all(context).find { it.optString("id") == id } ?: throw TransferStopped()
    if (task.optString("status") in listOf("paused", "cancelled") || !TransferStore.hasCredentials(context, owner)) throw TransferStopped()
  }
  private fun request(config: JSONObject, path: String, body: JSONObject? = null, stream: ((HttpURLConnection) -> Unit)? = null): JSONObject {
    val prefix = if (path.startsWith("/direct/")) "/upload" else "/files/upload"
    val connection = URL(config.getString("baseUrl").trimEnd('/') + prefix + path).openConnection() as HttpURLConnection
    activeConnection = connection
    try {
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 30000; connection.readTimeout = 600000
      connection.setRequestProperty("Authorization", "Bearer " + config.getString("token"))
      if (body != null || stream != null) {
        connection.requestMethod = "POST"; connection.doOutput = true
        if (body != null) {
          val bytes = body.toString().toByteArray()
          connection.setRequestProperty("Content-Type", "application/json")
          connection.setFixedLengthStreamingMode(bytes.size)
          connection.outputStream.use { it.write(bytes) }
        } else stream!!(connection)
      }
      val code = connection.responseCode
      val data = (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
      val result = try { JSONObject(data) } catch (_: Exception) { JSONObject().put("message", "Transfer failed ($code)") }
      if (code !in 200..299 || result.optBoolean("success", true) == false) throw TransferHttpError(code, result)
      return result
    } finally { connection.disconnect(); activeConnection = null }
  }
  private fun upload(task: JSONObject, config: JSONObject) {
    val id = task.getString("id"); guard(id)
    val file = File(URI(task.getJSONObject("file").getString("uri")))
    val sourceRoot = File(context.filesDir, "upload-sources").canonicalFile
    check(file.canonicalPath.startsWith(sourceRoot.path + File.separator) && file.isFile) { "Selected upload source is unavailable" }
    val size = task.getJSONObject("file").getLong("size")
    check(file.length() == size && size > 0) { "Selected file changed. Select it again." }
    val direct = runCatching { DirectTelegram.get(context,owner) }.getOrNull()
    if (task.optString("directId").isNotEmpty() || (task.optString("uploadId").isEmpty() && task.optString("chatTarget","me") == "me" && direct?.ready() == true)) {
      check(direct?.ready() == true) { "Reconnect the same Telegram account to resume this direct upload" }
      uploadDirect(task,config,file,direct!!); return
    }
    var uploadId = task.optString("uploadId")
    var status: JSONObject
    if (uploadId.isBlank()) {
      val f = task.getJSONObject("file")
      val network=context.getSystemService(android.net.ConnectivityManager::class.java)
      val caps=network.getNetworkCapabilities(network.activeNetwork)
      val selectedChunk=if(caps?.hasTransport(android.net.NetworkCapabilities.TRANSPORT_WIFI)==true) 5*1024*1024 else 1024*1024
      status = request(config, "/init", JSONObject().put("originalname", f.getString("name")).put("size", size)
        .put("mimetype", f.optString("mimeType", "application/octet-stream")).put("folder_id", task.opt("folderId") ?: JSONObject.NULL)
        .put("telegram_chat_id", task.optString("chatTarget", "me")).put("client_upload_key", id).put("chunk_size_bytes", selectedChunk))
      uploadId = status.getString("uploadId")
      TransferStore.patch(context, id) { it.put("uploadId", uploadId);it.put("chunkSizeBytes",status.optInt("chunkSizeBytes",selectedChunk)) }
    } else {
      status = request(config, "/status/$uploadId")
      if (status.optString("status") == "paused") status = request(config, "/resume-paused", JSONObject().put("uploadId", uploadId))
    }
    guard(id)
    val remote = status.optString("status")
    if (remote == "completed") { complete(task); return }
    if (remote in listOf("processing", "uploading_to_telegram")) {
      TransferStore.patch(context, id) { it.put("status", "processing"); it.put("bytesUploaded", size); it.put("progress", status.optDouble("progress", 50.0).coerceIn(50.0, 99.0)); it.put("retryCount", 0); it.put("retryAt", 0); it.remove("error") }
      return
    }
    if (remote == "queued") { request(config, "/heartbeat", JSONObject().put("uploadId", uploadId)); return }
    if (remote in listOf("error", "failed", "cancelled")) throw TransferHttpError(409, JSONObject().put("message", status.optString("error", "Upload session ended. Retry the file.")).put("retryable", false))
    val parts = status.optJSONArray("uploadedChunks")
    val uploaded = (0 until (parts?.length() ?: 0)).map { parts!!.getInt(it) }.toSet()
    val chunkSize = status.optInt("chunkSizeBytes",task.optInt("chunkSizeBytes",5*1024*1024))
    check(chunkSize in listOf(256*1024,512*1024,1024*1024,2*1024*1024,5*1024*1024)) { "Unsupported upload chunk size" }
    val count = ((size + chunkSize - 1) / chunkSize).toInt()
    var acknowledged = status.optLong("receivedBytes", 0)
    for (index in 0 until count) {
      if (index in uploaded) continue
      guard(id)
      val offset = index.toLong() * chunkSize; val length = minOf(chunkSize.toLong(), size - offset)
      val boundary = "Axya$id$index"
      val prefix = ("--$boundary\r\nContent-Disposition: form-data; name=\"uploadId\"\r\n\r\n$uploadId\r\n" +
        "--$boundary\r\nContent-Disposition: form-data; name=\"chunkIndex\"\r\n\r\n$index\r\n" +
        "--$boundary\r\nContent-Disposition: form-data; name=\"chunk\"; filename=\"chunk.bin\"\r\nContent-Type: application/octet-stream\r\n\r\n").toByteArray()
      val suffix = "\r\n--$boundary--\r\n".toByteArray()
      TransferStore.patch(context, id) { it.put("status", "uploading"); it.remove("error") }
      request(config, "/chunk", stream = { connection ->
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
        connection.setFixedLengthStreamingMode(prefix.size.toLong() + length + suffix.size)
        connection.outputStream.use { output ->
          output.write(prefix)
          RandomAccessFile(file, "r").use { input ->
            input.seek(offset); var remaining = length; val buffer = ByteArray(64 * 1024)
            while (remaining > 0) {
              guard(id); val read = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
              check(read > 0) { "Upload source ended unexpectedly" }; output.write(buffer, 0, read); remaining -= read
            }
          }
          output.write(suffix)
        }
      })
      acknowledged += length
      TransferStore.patch(context, id) { it.put("bytesUploaded", acknowledged); it.put("progress", acknowledged.toDouble() / size * 50); it.put("retryCount", 0); it.put("retryAt", 0); it.remove("error") }
      notify(task.getJSONObject("file").getString("name"), (acknowledged.toDouble() / size * 50).toInt())
    }
    guard(id); request(config, "/complete", JSONObject().put("uploadId", uploadId))
    TransferStore.patch(context, id) { it.put("status", "processing"); it.put("progress", 50); it.put("bytesUploaded", size) }
  }
  private fun uploadDirect(task: JSONObject, config: JSONObject, file: File, direct: DirectTelegram) {
    val id = task.getString("id"); guard(id)
    var directId = task.optString("directId"); var marker = task.optString("directMarker")
    if (directId.isEmpty()) {
      val f = task.getJSONObject("file")
      val result = request(config,"/direct/init",JSONObject().put("clientKey",id).put("name",f.getString("name"))
        .put("size",f.getLong("size")).put("mime",f.optString("mimeType","application/octet-stream"))
        .put("folderId",task.opt("folderId")?:JSONObject.NULL))
      directId = result.getString("id"); marker = result.getString("marker")
      TransferStore.patch(context,id) { it.put("directId",directId); it.put("directMarker",marker) }
      if (result.optBoolean("completed")) { request(config,"/direct/$directId/complete",JSONObject()); guard(id); complete(task); return }
    }
    guard(id)
    var messageId = task.optLong("tdMessageId")
    if (messageId == 0L) {
      messageId = direct.send(task,file.absolutePath,marker)
      TransferStore.patch(context,id) { it.put("tdMessageId",messageId) }
    }
    try { guard(id) } catch (stopped: TransferStopped) {
      if (!this.stopped()) runCatching { direct.cancel(messageId); TransferStore.patch(context,id) { it.remove("tdMessageId") } }
      throw stopped
    }
    val status = try { direct.progress(messageId) } catch (error: Exception) {
      // TDLib changes temporary message IDs when sending succeeds. Search the
      // persisted marker after process death; never blindly resend on timeout.
      val recovered = direct.resolve(marker) ?: throw error
      TransferStore.patch(context,id) { it.put("tdMessageId",recovered) }
      direct.progress(recovered)
    }
    guard(id)
    val size = task.getJSONObject("file").getLong("size")
    TransferStore.patch(context,id) { it.put("status",if(status.first) "processing" else "uploading")
      it.put("bytesUploaded",minOf(size,status.second)); it.put("progress",(status.second.toDouble()/size*95).coerceIn(0.0,95.0))
      it.put("retryAt",0); it.put("retryCount",0); it.remove("error") }
    if (status.first) { request(config,"/direct/$directId/complete",JSONObject()); guard(id); complete(task) }
  }
  private fun complete(task: JSONObject) {
    val id = task.getString("id")
    TransferStore.patch(context, id) { it.put("status", "completed"); it.put("progress", 100); it.put("bytesUploaded", it.getJSONObject("file").getLong("size")); it.put("completedAt", System.currentTimeMillis()); it.remove("error") }
    // Only remove the retained source once Telegram and metadata both confirm completion.
    runCatching { File(URI(task.getJSONObject("file").getString("uri"))).delete() }
    if (task.optString("directId").isNotEmpty()) runCatching { DirectTelegram.get(context,owner)?.cleanup(id) }
  }
  fun run(): Boolean {
    while (!stopped()) {
      val config = TransferStore.config(context, owner) ?: return false
      val network = context.getSystemService(android.net.ConnectivityManager::class.java)
      val capabilities = network.getNetworkCapabilities(network.activeNetwork)
      if (capabilities?.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_INTERNET) != true) return true
      val tasks = TransferStore.all(context).filter { it.optString("owner") == owner && it.optString("status") !in listOf("completed", "cancelled", "failed", "paused") }
        // A fixed first-12 slice starves the rest of a large photo selection when
        // those first files are waiting on Telegram or a retry timer.
        .filter { it.optLong("retryAt") <= System.currentTimeMillis() }
        .sortedWith(compareByDescending<JSONObject> { it.optInt("priority") }
          .thenBy { lastVisited[it.getString("id")] ?: 0L }.thenBy { it.optLong("createdAt") }).take(12)
      if (tasks.isEmpty()) {
        val unfinished = TransferStore.all(context).any { it.optString("owner") == owner && it.optString("status") !in listOf("completed", "cancelled", "failed", "paused") }
        if (!unfinished) return false
        Thread.sleep(2500); continue
      }
      for (task in tasks) {
        if (stopped()) return true
        if (task.optLong("retryAt") > System.currentTimeMillis()) continue
        val claim = "$owner:${task.getString("id")}"; if (!claims.add(claim)) continue
        lastVisited[task.getString("id")] = android.os.SystemClock.elapsedRealtime()
        try { upload(task, config) }
        catch (_: TransferStopped) { if (stopped()) return true }
        catch (e: Exception) {
          val id = task.getString("id")
          val current = TransferStore.all(context).find { it.optString("id") == id }
          if (current?.optString("status") in listOf("paused", "cancelled")) continue
          val permanent = e is TransferHttpError && (e.code in listOf(400, 401, 403, 413, 415) || !e.payload.optBoolean("retryable", true))
          TransferStore.patch(context, id) {
            if (e is TransferHttpError && e.code == 404) { it.remove("uploadId"); it.put("bytesUploaded", 0); it.put("progress", 0) }
            val attempts = it.optInt("retryCount") + 1
            it.put("retryCount", attempts); it.put("status", if (permanent || attempts > 12) "failed" else "waiting_retry")
            it.put("error", if (e is TransferHttpError && e.code == 401) "Sign in again to resume this upload." else e.message ?: "Waiting to retry")
            it.put("retryAt", System.currentTimeMillis() + minOf(60000L, 2000L shl minOf(attempts, 5)))
          }
        } finally { claims.remove(claim) }
      }
      notify("Saving your files to Telegram", 0)
      Thread.sleep(2500)
    }
    return true
  }
}
