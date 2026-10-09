package expo.modules.axyatransfer

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal object TransferStore {
  fun hasCredentials(c:Context,owner:String)=prefs(c).contains("credentials:$owner")
  private fun prefs(c: Context) = c.getSharedPreferences("axya_native_transfers", Context.MODE_PRIVATE)
  @Synchronized fun all(c: Context): List<JSONObject> {
    val a = JSONArray(prefs(c).getString("tasks", "[]"))
    return (0 until a.length()).map { a.getJSONObject(it) }
  }
  @Synchronized fun put(c: Context, task: JSONObject) {
    val updated = all(c).filter { it.optString("id") != task.getString("id") } + task
    val terminal=updated.filter { it.optString("owner")==task.optString("owner") && it.optString("status") in listOf("completed","cancelled") }.sortedByDescending { it.optLong("updatedAt") }.take(120).map { it.getString("id") }.toSet()
    val tasks=updated.filter { it.optString("owner")!=task.optString("owner") || it.optString("status") !in listOf("completed","cancelled") || it.getString("id") in terminal }
    check(prefs(c).edit().putString("tasks", JSONArray(tasks).toString()).commit()) { "Could not persist transfer" }
  }
  @Synchronized fun patch(c: Context, id: String, block: (JSONObject) -> Unit) {
    val task = all(c).find { it.optString("id") == id } ?: return
    block(task); task.put("updatedAt", System.currentTimeMillis()); put(c, task)
  }
  @Synchronized fun removeFinished(c: Context, owner: String) {
    val kept = all(c).filter { it.optString("owner") != owner || it.optString("status") !in listOf("completed", "cancelled") }
    check(prefs(c).edit().putString("tasks", JSONArray(kept).toString()).commit())
  }
  @Synchronized fun action(c: Context, owner: String, action: String) {
    all(c).filter { it.optString("owner") == owner }.forEach { t ->
      val status = t.optString("status")
      if (action == "pause" && status !in listOf("completed", "cancelled", "failed")) patch(c, t.getString("id")) { it.put("status", "paused"); it.put("manualPause", true) }
      if (action == "resume" && status in listOf("paused", "waiting_retry", "failed")) patch(c, t.getString("id")) { it.put("status", "queued"); it.put("manualPause", false); it.remove("error") }
    }
  }
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey("axya_transfer_credentials", null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder("axya_transfer_credentials", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  @Synchronized fun credentials(c: Context, owner: String, config: JSONObject?) {
    val editor = prefs(c).edit()
    if (config == null) editor.remove("credentials:$owner") else {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
      cipher.updateAAD(owner.toByteArray())
      val encrypted = cipher.doFinal(config.toString().toByteArray())
      editor.putString("credentials:$owner", Base64.encodeToString(cipher.iv + encrypted, Base64.NO_WRAP))
    }
    check(editor.commit()) { "Could not save credentials" }
  }
  @Synchronized fun config(c: Context, owner: String): JSONObject? {
    val encoded = prefs(c).getString("credentials:$owner", null) ?: return null
    val bytes = Base64.decode(encoded, Base64.NO_WRAP)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12))) }
    cipher.updateAAD(owner.toByteArray())
    return JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size))))
  }
}
