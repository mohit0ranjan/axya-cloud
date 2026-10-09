package expo.modules.axyatransfer

import android.content.ContentUris
import android.content.Context
import android.provider.MediaStore
import androidx.work.*
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

internal object PhotoBackup {
  fun preferences(c:Context) = c.getSharedPreferences("axya_photo_backup",Context.MODE_PRIVATE)
  fun schedule(c:Context,owner:String) {
    val p=preferences(c); val enabled=JSONObject(p.getString(owner,"{}")).optBoolean("enabled")
    if (!enabled) { WorkManager.getInstance(c).cancelUniqueWork("axya-backup:$owner"); WorkManager.getInstance(c).cancelUniqueWork("axya-backup-now:$owner"); return }
    val config=TransferStore.config(c,owner) ?: return
    val constraints=Constraints.Builder().setRequiredNetworkType(if(config.optBoolean("wifiOnly")) NetworkType.UNMETERED else NetworkType.CONNECTED).setRequiresCharging(config.optBoolean("chargingOnly")).setRequiresStorageNotLow(true).build()
    WorkManager.getInstance(c).enqueueUniquePeriodicWork("axya-backup:$owner",ExistingPeriodicWorkPolicy.UPDATE,
      PeriodicWorkRequestBuilder<PhotoBackupWorker>(15,TimeUnit.MINUTES).setInputData(workDataOf("owner" to owner)).setConstraints(constraints).build())
    WorkManager.getInstance(c).enqueueUniqueWork("axya-backup-now:$owner",ExistingWorkPolicy.KEEP,
      OneTimeWorkRequestBuilder<PhotoBackupWorker>().setInputData(workDataOf("owner" to owner)).setConstraints(constraints).build())
  }
}

class PhotoBackupWorker(c:Context,params:WorkerParameters):Worker(c,params) {
  override fun doWork():Result {
    val owner=inputData.getString("owner") ?: return Result.failure()
    val p=PhotoBackup.preferences(applicationContext); var config=JSONObject(p.getString(owner,"{}"))
    if (!config.optBoolean("enabled") || TransferStore.config(applicationContext,owner)==null) return Result.success()
    if (TransferStore.all(applicationContext).count { it.optString("owner")==owner && it.optString("status") !in listOf("completed","cancelled") }>180) return Result.retry()
    try {
      val uri=MediaStore.Images.Media.EXTERNAL_CONTENT_URI
      val projection=arrayOf(MediaStore.Images.Media._ID,MediaStore.Images.Media.DISPLAY_NAME,MediaStore.Images.Media.MIME_TYPE,MediaStore.Images.Media.SIZE,MediaStore.Images.Media.DATE_ADDED)
      val date=config.optLong("date");val lastId=config.optLong("lastId")
      applicationContext.contentResolver.query(uri,projection,"${MediaStore.Images.Media.BUCKET_ID}=? AND (${MediaStore.Images.Media.DATE_ADDED}>? OR (${MediaStore.Images.Media.DATE_ADDED}=? AND ${MediaStore.Images.Media._ID}>?))",arrayOf(config.getString("album"),date.toString(),date.toString(),lastId.toString()),"${MediaStore.Images.Media.DATE_ADDED} ASC,${MediaStore.Images.Media._ID} ASC")?.use { cursor ->
        var count=0
        while(cursor.moveToNext() && count<100 && !isStopped) {
          // Re-read opt-in and credentials so sign-out or disable stops ingestion.
          config=JSONObject(p.getString(owner,"{}")); if(!config.optBoolean("enabled")||TransferStore.config(applicationContext,owner)==null)return Result.success()
          val id=cursor.getLong(0);val added=cursor.getLong(4);val taskId="backup_${owner}_${config.optString("generation")}_${id}"
          if(TransferStore.all(applicationContext).none { it.optString("id")==taskId }) {
            val root=File(applicationContext.filesDir,"upload-sources/$owner");check(root.mkdirs()||root.isDirectory)
            val target=File(root,"$taskId.source");val partial=File(root,"$taskId.partial")
            try {
              applicationContext.contentResolver.openInputStream(ContentUris.withAppendedId(uri,id)).use { input -> checkNotNull(input);partial.outputStream().use { output -> input.copyTo(output,65536) } }
              check(partial.length()==cursor.getLong(3) && partial.length()>0);check(partial.renameTo(target))
              val now=System.currentTimeMillis();val file=JSONObject().put("uri",target.toURI().toString()).put("name",cursor.getString(1)).put("mimeType",cursor.getString(2)).put("size",target.length())
              TransferStore.put(applicationContext,JSONObject().put("owner",owner).put("id",taskId).put("file",file).put("folderId",config.opt("folder")?:JSONObject.NULL).put("chatTarget","me").put("status","queued").put("nativeOwned",true).put("fingerprint",taskId).put("retryCount",0).put("progress",0).put("bytesUploaded",0).put("createdAt",now).put("updatedAt",now))
            } catch(e:Exception) { partial.delete(); throw e }
          }
          config.put("date",added).put("lastId",id);check(p.edit().putString(owner,config.toString()).commit());count++
        }
      }
      TransferScheduler.schedule(applicationContext,owner);return Result.success()
    } catch(_:SecurityException) {
      config.put("error","Photo access was removed. Open Photo backup to grant access again.");p.edit().putString(owner,config.toString()).commit();return Result.failure()
    } catch(_:Exception) { return Result.retry() }
  }
}
