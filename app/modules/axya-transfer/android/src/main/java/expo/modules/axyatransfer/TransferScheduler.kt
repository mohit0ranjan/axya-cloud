package expo.modules.axyatransfer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PersistableBundle
import androidx.core.app.NotificationCompat
import androidx.work.*
import java.util.concurrent.TimeUnit

internal object TransferScheduler {
  fun finishNotification(c: Context, owner: String) {
    if (!TransferStore.hasCredentials(c, owner)) return
    val tasks = TransferStore.all(c).filter { it.optString("owner") == owner }
    if (tasks.isEmpty() || tasks.any { it.optString("status") !in listOf("completed", "cancelled", "failed") }) return
    val failed = tasks.any { it.optString("status") == "failed" }
    val manager = c.getSystemService(NotificationManager::class.java)
    val launch = c.packageManager.getLaunchIntentForPackage(c.packageName)
    val intent = launch?.let { PendingIntent.getActivity(c, notificationId(owner) + 1, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
    val notification = NotificationCompat.Builder(c, "axya_native_uploads")
      .setSmallIcon(if (failed) android.R.drawable.stat_notify_error else android.R.drawable.stat_sys_upload_done)
      .setContentTitle(if (failed) "Uploads need attention" else "Uploads finished")
      .setContentText(if (failed) "Open Axya to retry failed transfers." else "Your files are saved in Telegram.")
      .setContentIntent(intent).setAutoCancel(true).build()
    runCatching { manager.notify(notificationId(owner) + 1, notification) }
  }
  fun notificationId(owner: String) = 20000 + (owner.hashCode() and 0x3fffffff) % 100000
  fun notification(c: Context, owner: String, title: String, progress: Int): Notification {
    val manager = c.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel("axya_native_uploads", "File transfers", NotificationManager.IMPORTANCE_LOW))
    val launch = c.packageManager.getLaunchIntentForPackage(c.packageName)
    val content = launch?.let { PendingIntent.getActivity(c, notificationId(owner), it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
    fun action(value: String) = PendingIntent.getBroadcast(c, notificationId(owner) + value.hashCode(),
      Intent(c, TransferActionReceiver::class.java).putExtra("owner", owner).putExtra("action", value), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(c, "axya_native_uploads").setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle("Axya · File transfers").setContentText(title).setContentIntent(content).setOnlyAlertOnce(true).setOngoing(true)
      .setProgress(100, progress.coerceIn(0, 100), progress == 0)
      .addAction(android.R.drawable.ic_media_pause, "Pause all", action("pause"))
      .addAction(android.R.drawable.ic_media_play, "Resume all", action("resume")).build()
  }
  fun schedule(c: Context, owner: String) {
    val config = TransferStore.config(c, owner) ?: return
    WorkManager.getInstance(c).enqueueUniquePeriodicWork("axya-transfer-watchdog",ExistingPeriodicWorkPolicy.KEEP,
      PeriodicWorkRequestBuilder<TransferWatchdogWorker>(15,TimeUnit.MINUTES).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
    if (Build.VERSION.SDK_INT >= 34) {
      val jobs = c.getSystemService(JobScheduler::class.java)
      if (jobs.getPendingJob(notificationId(owner)) != null) return
      val extras = PersistableBundle().apply { putString("owner", owner) }
      val builder = JobInfo.Builder(notificationId(owner), ComponentName(c, TransferJob::class.java))
        .setUserInitiated(true).setPersisted(true).setExtras(extras)
        .setRequiredNetworkType(if (config.optBoolean("wifiOnly")) JobInfo.NETWORK_TYPE_UNMETERED else JobInfo.NETWORK_TYPE_ANY)
        .setRequiresCharging(config.optBoolean("chargingOnly")).setRequiresStorageNotLow(true)
      val bytes = TransferStore.all(c).filter { it.optString("owner") == owner && it.optString("status") !in listOf("completed", "cancelled") }
        .sumOf { it.getJSONObject("file").optLong("size") }
      builder.setEstimatedNetworkBytes(0, bytes.coerceAtLeast(1))
      try { if (jobs.schedule(builder.build()) == JobScheduler.RESULT_SUCCESS) return } catch (_: RuntimeException) { }
    }
    val constraints = Constraints.Builder().setRequiredNetworkType(if (config.optBoolean("wifiOnly")) NetworkType.UNMETERED else NetworkType.CONNECTED)
      .setRequiresCharging(config.optBoolean("chargingOnly")).setRequiresStorageNotLow(true).build()
    val work = OneTimeWorkRequestBuilder<TransferWorker>().setInputData(workDataOf("owner" to owner)).setConstraints(constraints)
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS).build()
    WorkManager.getInstance(c).enqueueUniqueWork("axya:$owner", ExistingWorkPolicy.KEEP, work)
  }
  fun stop(c: Context, owner: String) {
    c.getSystemService(JobScheduler::class.java).cancel(notificationId(owner))
    WorkManager.getInstance(c).cancelUniqueWork("axya:$owner")
    c.getSystemService(NotificationManager::class.java).cancel(notificationId(owner))
    c.getSystemService(NotificationManager::class.java).cancel(notificationId(owner) + 1)
  }
}
class TransferActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val owner = intent.getStringExtra("owner") ?: return
    val action = intent.getStringExtra("action") ?: return
    TransferStore.action(context, owner, action)
    if (action == "pause") TransferScheduler.stop(context, owner) else TransferScheduler.schedule(context, owner)
  }
}
