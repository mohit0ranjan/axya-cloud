package expo.modules.axyatransfer

import android.app.job.JobParameters
import android.app.job.JobService
import android.os.Build
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.ConcurrentHashMap

class TransferJob : JobService() {
  private class Run { val stopped = AtomicBoolean(false); val runners = mutableListOf<TransferRunner>() }
  private val runs = ConcurrentHashMap<Int, Run>()
  override fun onStartJob(params: JobParameters): Boolean {
    val owner = params.extras.getString("owner") ?: return false
    val run = Run()
    runs.put(params.jobId, run)?.let { old -> old.stopped.set(true); old.runners.forEach { it.stop() } }
    if (Build.VERSION.SDK_INT >= 34) setNotification(params, TransferScheduler.notificationId(owner),
      TransferScheduler.notification(this, owner, "Preparing your files", 0), JOB_END_NOTIFICATION_POLICY_REMOVE)
    val executor = Executors.newFixedThreadPool(3)
    val futures = (0 until 3).map {
      val runner = TransferRunner(applicationContext, owner, { run.stopped.get() }) { title, progress ->
        if (!run.stopped.get() && Build.VERSION.SDK_INT >= 34) setNotification(params, TransferScheduler.notificationId(owner),
          TransferScheduler.notification(this, owner, title, progress), JOB_END_NOTIFICATION_POLICY_REMOVE)
      }
      run.runners.add(runner); executor.submit<Boolean> { runner.run() }
    }
    Thread {
      val retry = futures.map { runCatching { it.get() }.getOrDefault(true) }.any { it }
      executor.shutdown()
      if (runs.remove(params.jobId, run) && !run.stopped.get()) {
        if (!retry) TransferScheduler.finishNotification(applicationContext, owner)
        jobFinished(params, retry)
      }
    }.start()
    return true
  }
  override fun onStopJob(params: JobParameters): Boolean {
    runs.remove(params.jobId)?.let { run -> run.stopped.set(true); run.runners.forEach { it.stop() } }
    return true
  }
}
