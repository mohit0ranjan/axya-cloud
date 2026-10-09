package expo.modules.axyatransfer

import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import java.util.concurrent.Executors

class TransferWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  private val runners = mutableListOf<TransferRunner>()
  override suspend fun getForegroundInfo(): ForegroundInfo {
    val owner = inputData.getString("owner") ?: ""
    val notification = TransferScheduler.notification(applicationContext, owner, "Preparing your files", 0)
    return if (Build.VERSION.SDK_INT >= 29) ForegroundInfo(TransferScheduler.notificationId(owner), notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      else ForegroundInfo(TransferScheduler.notificationId(owner), notification)
  }
  override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
    val owner = inputData.getString("owner") ?: return@withContext Result.failure()
    try {
      setForeground(getForegroundInfo())
      suspendCancellableCoroutine<Result> { continuation ->
        val executor = Executors.newFixedThreadPool(3)
        val futures = (0 until 3).map {
          val runner = TransferRunner(applicationContext, owner, { isStopped }) { title, progress ->
            val notification = TransferScheduler.notification(applicationContext, owner, title, progress)
            applicationContext.getSystemService(android.app.NotificationManager::class.java).notify(TransferScheduler.notificationId(owner), notification)
          }
          runners.add(runner); executor.submit<Boolean> { runner.run() }
        }
        continuation.invokeOnCancellation { runners.forEach { it.stop() }; futures.forEach { it.cancel(true) }; executor.shutdownNow() }
        Thread {
          try {
            val retry = futures.map { runCatching { it.get() }.getOrDefault(true) }.any { it }
            if (continuation.isActive) {
              if (!retry) TransferScheduler.finishNotification(applicationContext, owner)
              continuation.resume(if (retry) Result.retry() else Result.success())
            }
          } finally { runners.forEach { it.stop() }; executor.shutdownNow() }
        }.start()
      }
    } catch (_: Exception) { Result.retry() }
  }
}
