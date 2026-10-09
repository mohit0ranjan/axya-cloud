package expo.modules.axyatransfer

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import com.google.mlkit.vision.documentscanner.*
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URI
import java.security.MessageDigest

class AxyaTransferModule : Module() {
  private val context get() = requireNotNull(appContext.reactContext)
  private var scannerPromise: Promise? = null
  private var sharedIntent: Intent? = null
  override fun definition() = ModuleDefinition {
    Name("AxyaTransfer")
    Events("incomingShare")
    OnNewIntent { intent ->
      if (intent.action in listOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) { sharedIntent = intent; sendEvent("incomingShare", emptyMap<String, Any>()) }
    }
    OnActivityResult { _, result ->
      if (result.requestCode != 5641) return@OnActivityResult
      val promise = scannerPromise ?: return@OnActivityResult; scannerPromise = null
      if (result.resultCode != Activity.RESULT_OK) { promise.resolve(null); return@OnActivityResult }
      val pdf = GmsDocumentScanningResult.fromActivityResultIntent(result.data)?.pdf
      if (pdf == null) { promise.reject("scan_error", "No scanned PDF was returned", null); return@OnActivityResult }
      promise.resolve(JSONObject().put("uri", pdf.uri.toString()).put("pages", pdf.pageCount).toString())
    }
    OnDestroy { scannerPromise?.reject("scanner_closed", "Scanner was closed", null); scannerPromise = null }
    AsyncFunction("configure") { owner: String, token: String, baseUrl: String, wifiOnly: Boolean, chargingOnly: Boolean ->
      require(owner.matches(Regex("[a-zA-Z0-9_-]{1,80}")))
      val parsed = URI(baseUrl)
      require(parsed.scheme == "https" || (parsed.scheme == "http" && parsed.host in listOf("localhost", "10.0.2.2", "127.0.0.1"))) { "Uploads require a secure API address" }
      val previous = TransferStore.config(context, owner)
      if (previous != null && (previous.optBoolean("wifiOnly") != wifiOnly || previous.optBoolean("chargingOnly") != chargingOnly)) TransferScheduler.stop(context, owner)
      TransferStore.credentials(context, owner, JSONObject().put("token", token).put("baseUrl", baseUrl).put("wifiOnly", wifiOnly).put("chargingOnly", chargingOnly))
      TransferStore.all(context).filter { it.optString("owner") == owner && it.optBoolean("pausedForAccount") }.forEach { t ->
        TransferStore.patch(context, t.getString("id")) { it.put("status", "queued"); it.put("pausedForAccount", false) }
      }
      TransferScheduler.schedule(context, owner)
      PhotoBackup.schedule(context, owner)
    }
    AsyncFunction("detach") { owner: String ->
      TransferStore.all(context).filter { it.optString("owner") == owner && it.optString("status") !in listOf("completed", "cancelled", "failed", "paused") }.forEach { t ->
        TransferStore.patch(context, t.getString("id")) { it.put("status", "paused"); it.put("pausedForAccount", true) }
      }
      TransferStore.credentials(context, owner, null); TransferScheduler.stop(context, owner)
    }
    AsyncFunction("enqueue") { owner: String, serialized: String ->
      val tasks = JSONArray(serialized)
      for (i in 0 until tasks.length()) {
        val task = tasks.getJSONObject(i); task.put("owner", owner)
        if (TransferStore.all(context).none { it.optString("id") == task.optString("id") }) TransferStore.put(context, task)
      }
      TransferScheduler.schedule(context, owner)
    }
    AsyncFunction("snapshot") { owner: String ->
      val tasks=TransferStore.all(context).filter { it.optString("owner") == owner }
      if(tasks.any { it.optString("status") !in listOf("completed","cancelled","failed","paused") }) TransferScheduler.schedule(context,owner)
      JSONArray(tasks).toString()
    }
    AsyncFunction("configureBackup") { owner: String, album: String, folder: String?, enabled: Boolean ->
      require(owner.matches(Regex("[a-zA-Z0-9_-]{1,80}")))
      val prefs=PhotoBackup.preferences(context); val old=JSONObject(prefs.getString(owner,"{}"))
      if(enabled) require(album.matches(Regex("-?[0-9]+"))) { "Choose an Android photo album" }
      val oldFolder=if(old.isNull("folder")) null else old.optString("folder")
      val next=if(old.optString("album")==album && oldFolder==folder) old else JSONObject().put("generation",System.currentTimeMillis().toString()).put("date",0).put("lastId",0)
      next.put("enabled",enabled).put("album",album).put("folder",folder?:JSONObject.NULL);next.remove("error")
      check(prefs.edit().putString(owner,next.toString()).commit());PhotoBackup.schedule(context,owner)
    }
    AsyncFunction("backupStatus") { owner:String -> PhotoBackup.preferences(context).getString(owner,"{}") }
    AsyncFunction("action") { owner: String, id: String, action: String ->
      require(TransferStore.all(context).any { it.optString("owner") == owner && it.optString("id") == id })
      TransferStore.patch(context, id) {
        when (action) {
          "pause" -> { it.put("status", "paused"); it.put("manualPause", true) }
          "resume" -> { if (it.optString("status") !in listOf("completed", "cancelled")) { it.put("status", "queued"); it.put("retryAt", 0); it.put("manualPause", false); it.remove("error") } }
          "retry" -> { if (it.optString("status") == "failed") { it.put("status", "queued"); it.put("retryCount", 0); it.put("retryAt", 0); it.remove("uploadId"); it.remove("error") } }
          "cancel" -> it.put("status", "cancelled")
          "priority" -> it.put("priority", 1)
        }
      }
      if (action in listOf("resume", "retry", "priority")) TransferScheduler.schedule(context, owner)
    }
    AsyncFunction("clearFinished") { owner: String ->
      // Keep the durable ledger for restart reconciliation; remove source bytes only.
      TransferStore.all(context).filter { it.optString("owner") == owner && it.optString("status") in listOf("completed", "cancelled") }.forEach {
        val file = File(URI(it.getJSONObject("file").getString("uri")))
        if (file.canonicalPath.startsWith(File(context.filesDir, "upload-sources").canonicalPath + File.separator)) file.delete()
      }
      TransferStore.removeFinished(context, owner)
    }
    AsyncFunction("sha256") { uri: String ->
      val digest = MessageDigest.getInstance("SHA-256")
      context.contentResolver.openInputStream(Uri.parse(uri)).use { input ->
        requireNotNull(input); val buffer = ByteArray(65536)
        while (true) { val n = input.read(buffer); if (n < 0) break; digest.update(buffer, 0, n) }
      }
      digest.digest().joinToString("") { "%02x".format(it) }
    }
    AsyncFunction("consumeShares") {
      val intent = sharedIntent ?: appContext.currentActivity?.intent
      if (intent?.action !in listOf(Intent.ACTION_SEND, Intent.ACTION_SEND_MULTIPLE)) return@AsyncFunction "[]"
      val uris = mutableListOf<Uri>()
      if (intent!!.action == Intent.ACTION_SEND) (intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM))?.let { uris.add(it) }
      else intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)?.let { uris.addAll(it) }
      sharedIntent = null; appContext.currentActivity?.intent?.action = Intent.ACTION_MAIN
      val results = JSONArray()
      uris.take(100).forEach { uri ->
        var name = "Shared file"; context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) { val col = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME); if (col >= 0) name = cursor.getString(col) }
        }
        results.put(JSONObject().put("uri", uri.toString()).put("name", name).put("mimeType", context.contentResolver.getType(uri) ?: "application/octet-stream").put("size", 0))
      }
      results.toString()
    }
    AsyncFunction("scanDocument") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null || scannerPromise != null) { promise.reject("scanner_busy", "Open Axya to scan a document", null); return@AsyncFunction }
      scannerPromise = promise
      activity.runOnUiThread {
        val options = GmsDocumentScannerOptions.Builder().setGalleryImportAllowed(true).setPageLimit(30)
          .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_PDF).setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL).build()
        GmsDocumentScanning.getClient(options).getStartScanIntent(activity)
          .addOnSuccessListener { sender ->
            try { activity.startIntentSenderForResult(sender, 5641, null, 0, 0, 0) }
            catch (e: Exception) { scannerPromise = null; promise.reject("scanner_unavailable", e.message, e) }
          }.addOnFailureListener { e -> scannerPromise = null; promise.reject("scanner_unavailable", e.message, e) }
      }
    }
  }
}
