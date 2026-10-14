package expo.modules.axyatransfer

import android.content.Context
import android.util.Base64
import org.drinkless.tdlib.Client
import org.drinkless.tdlib.TdApi
import org.json.JSONObject
import java.io.File
import java.security.SecureRandom
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.net.HttpURLConnection
import java.net.URL

// The background service owns this client. Each Axya account has an isolated,
// encrypted TDLib database; the server auth key is never sent to the phone.
internal class DirectTelegram private constructor(private val context: Context, private val owner: String, private val config: JSONObject) {
  companion object {
    private val clients = ConcurrentHashMap<String, DirectTelegram>()
    @Synchronized fun get(c: Context, owner: String): DirectTelegram? {
      if (!TransferStore.hasCredentials(c, owner)) return null
      val config = TransferStore.config(c, "tdlib:$owner") ?: return null
      return clients[owner] ?: DirectTelegram(c.applicationContext, owner, config).also { clients[owner] = it }
    }
    fun configure(c: Context, owner: String, raw: String): DirectTelegram {
      require(owner.matches(Regex("[a-zA-Z0-9_-]{1,80}")))
      val config = JSONObject(raw)
      require(config.getLong("telegramUserId") > 0 && config.getInt("apiId") > 0)
      val previous = TransferStore.config(c, "tdlib:$owner")
      config.put("dbKey", previous?.optString("dbKey")?.takeIf { it.isNotEmpty() } ?: Base64.encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) }, Base64.NO_WRAP))
      TransferStore.credentials(c, "tdlib:$owner", config)
      return get(c, owner) ?: error("Sign in to Axya first")
    }
    fun close(owner: String) { clients.remove(owner)?.client?.send(TdApi.Close()) {} }
    fun cleanupSource(c: Context, owner: String, taskId: String) {
      require(owner.matches(Regex("[a-zA-Z0-9_-]{1,80}")) && taskId.matches(Regex("[a-zA-Z0-9_-]{1,180}")))
      val dir = File(c.filesDir,"direct-sources/$owner/$taskId")
      dir.listFiles()?.forEach { it.delete() }; dir.delete()
    }
    fun cancelReservation(c: Context, owner: String, id: String): Boolean {
      require(id.matches(Regex("[a-fA-F0-9-]{36}")))
      val auth = TransferStore.config(c,owner) ?: error("Sign in again")
      val connection = URL(auth.getString("baseUrl").trimEnd('/')+"/upload/direct/$id/cancel").openConnection() as HttpURLConnection
      try {
        connection.connectTimeout=30000;connection.readTimeout=30000;connection.instanceFollowRedirects=false
        connection.requestMethod="POST";connection.doOutput=true
        connection.setRequestProperty("Authorization","Bearer "+auth.getString("token"))
        connection.setRequestProperty("Content-Type","application/json")
        connection.outputStream.use { it.write("{}".toByteArray()) }
        check(connection.responseCode in 200..299) { "Waiting for cancellation confirmation" }
        return JSONObject(connection.inputStream.bufferedReader().use { it.readText() }).optBoolean("completed")
      } finally { connection.disconnect() }
    }
  }
  @Volatile private var state = "Starting"
  @Volatile private var identityVerified = false
  private val completedIds = ConcurrentHashMap<Long, Long>()
  private val failures = ConcurrentHashMap<Long, String>()
  private val initialized = CompletableFuture<Client>()
  private val client: Client = Client.create({ update ->
    when (update) {
      is TdApi.UpdateAuthorizationState -> {
        state = update.authorizationState.javaClass.simpleName
        if (update.authorizationState is TdApi.AuthorizationStateWaitTdlibParameters) {
          val root = File(context.noBackupFilesDir, "tdlib/$owner").apply { mkdirs() }
          clientParameters(root)
        }
      }
      is TdApi.UpdateMessageSendSucceeded -> completedIds[update.oldMessageId] = update.message.id
      is TdApi.UpdateMessageSendFailed -> failures[update.oldMessageId] = "Telegram could not send this file. Retry the transfer."
    }
  }, null, null)
  init { initialized.complete(client) }
  private fun clientParameters(root: File) {
    val p = TdApi.SetTdlibParameters().apply {
      databaseDirectory = root.absolutePath; filesDirectory = File(root,"files").absolutePath
      databaseEncryptionKey = Base64.decode(config.getString("dbKey"), Base64.NO_WRAP)
      useFileDatabase = true; useChatInfoDatabase = true; useMessageDatabase = true; useSecretChats = false
      apiId = config.getInt("apiId"); apiHash = config.getString("apiHash")
      systemLanguageCode = "en"; deviceModel = android.os.Build.MODEL
      systemVersion = android.os.Build.VERSION.RELEASE; applicationVersion = "Axya 1.2"
    }
    // Initialization updates may race construction; wait on a separate thread.
    initialized.thenAccept { it.send(p) {} }
  }
  fun call(query: TdApi.Function<*>): TdApi.Object {
    val reply = CompletableFuture<TdApi.Object>()
    client.send(query) { result -> reply.complete(result) }
    val result = reply.get(45, TimeUnit.SECONDS)
    if (result is TdApi.Error) throw IllegalStateException("TDLib request failed (${result.code}): ${result.message}")
    return result
  }
  fun status(): JSONObject {
    if (state == "AuthorizationStateReady" && !identityVerified) {
      val me = call(TdApi.GetMe()) as TdApi.User
      if(me.id.toString() != config.getString("telegramUserId")) return JSONObject().put("state","WrongAccount").put("ready",false)
      identityVerified = true
    }
    return JSONObject().put("state",state).put("ready",identityVerified && state == "AuthorizationStateReady")
  }
  fun authenticate(kind: String, value: String) {
    when (kind) {
      "phone" -> call(TdApi.SetAuthenticationPhoneNumber(config.getString("phone"), null))
      "code" -> call(TdApi.CheckAuthenticationCode(value))
      "password" -> call(TdApi.CheckAuthenticationPassword(value))
      "logout" -> { call(TdApi.LogOut()); identityVerified = false; TransferStore.credentials(context,"tdlib:$owner",null); close(owner) }
      else -> error("Unsupported authorization action")
    }
  }
  fun ready() = status().optBoolean("ready")
  private fun chat() = (call(TdApi.CreatePrivateChat(config.getLong("telegramUserId"), false)) as TdApi.Chat).id
  fun send(task: JSONObject, path: String, marker: String): Long {
    check(ready()) { "Connect Telegram for direct uploads" }
    val chatId = chat()
    // Reconcile an acknowledgement lost before local persistence by marker.
    val found = call(TdApi.SearchChatMessages().apply { this.chatId = chatId; query = marker; limit = 10 }) as TdApi.FoundChatMessages
    found.messages.firstOrNull { m -> (m.content as? TdApi.MessageDocument)?.caption?.text?.split('\n')?.contains(marker) == true }?.let { return it.id }
    val name = task.getJSONObject("file").getString("name").replace(Regex("[\\\\/]"),"_").trim()
    val dir = File(context.filesDir,"direct-sources/$owner/${task.getString("id")}").apply { mkdirs() }
    val named = File(dir,name)
    check(named.canonicalFile.parentFile == dir.canonicalFile) { "Invalid source name" }
    if (!named.exists()) {
      try { android.system.Os.link(path,named.absolutePath) } catch (_: Exception) { File(path).copyTo(named,overwrite=true) }
    }
    check(named.length() == File(path).length()) { "Direct upload source changed" }
    val content = TdApi.InputMessageDocument().apply {
      document = TdApi.InputFileLocal(named.absolutePath); disableContentTypeDetection = true
      caption = TdApi.FormattedText("[Axya] " + task.getJSONObject("file").getString("name") + "\n" + marker, emptyArray())
    }
    val sent = call(TdApi.SendMessage().apply { this.chatId = chatId; inputMessageContent = content }) as TdApi.Message
    return sent.id
  }
  fun progress(id: Long): Pair<Boolean, Long> {
    failures.remove(id)?.let { throw IllegalStateException(it) }
    val resolved = completedIds[id] ?: id
    val message = call(TdApi.GetMessage(chat(), resolved)) as TdApi.Message
    if (message.sendingState is TdApi.MessageSendingStateFailed) error("Telegram delivery failed. Retry the transfer.")
    val file = (message.content as? TdApi.MessageDocument)?.document?.document
    return Pair(message.sendingState == null, file?.remote?.uploadedSize ?: 0L)
  }
  fun resolve(marker: String): Long? {
    val found = call(TdApi.SearchChatMessages().apply { chatId = chat(); query = marker; limit = 10 }) as TdApi.FoundChatMessages
    return found.messages.firstOrNull { m -> (m.content as? TdApi.MessageDocument)?.caption?.text?.split('\n')?.contains(marker) == true }?.id
  }
  fun cancel(id: Long) {
    if (id == 0L) return
    // A fully sent file must remain available for backend reconciliation.
    // Cancel only the pending send on pause; completed delivery wins this race.
    if (progress(id).first) return
    call(TdApi.DeleteMessages(chat(), longArrayOf(completedIds[id] ?: id), true))
    completedIds.remove(id); failures.remove(id)
  }
  fun cleanup(taskId: String) {
    cleanupSource(context,owner,taskId)
  }
}
