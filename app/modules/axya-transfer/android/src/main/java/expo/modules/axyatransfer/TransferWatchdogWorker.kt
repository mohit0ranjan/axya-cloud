package expo.modules.axyatransfer
import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
class TransferWatchdogWorker(c:Context,p:WorkerParameters):Worker(c,p) {
  override fun doWork():Result {
    return try {
      TransferStore.all(applicationContext).filter { it.optString("status") !in listOf("completed","cancelled","failed","paused") }.map { it.getString("owner") }.distinct().forEach { owner ->
        if(TransferStore.config(applicationContext,owner)!=null)TransferScheduler.schedule(applicationContext,owner)
      };Result.success()
    }catch(_:Exception){Result.retry()}
  }
}
