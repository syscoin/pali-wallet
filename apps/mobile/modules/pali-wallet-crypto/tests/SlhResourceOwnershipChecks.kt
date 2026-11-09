package expo.modules.paliwalletcrypto

import android.content.Context
import expo.modules.kotlin.Promise
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Exact production Kotlin + JNI file code, with only Android/Expo shell types stubbed.
 * No crypto executes and no SharedObject GC callback is invoked by this check. */
private object SlhResourceNative {
  init { System.loadLibrary("pali_slh_engine") }
  @JvmStatic external fun descriptorOpen(fd: Int): Boolean
}
private class SlhCompletion : Promise {
  private val done = CountDownLatch(1)
  var result: Any? = null
  var error: String? = null
  override fun resolve(value: Any?) { result = value; done.countDown() }
  override fun reject(code: String?, message: String?, cause: Throwable?) { error = code; done.countDown() }
  fun await() { check(done.await(20, TimeUnit.SECONDS)) { "Native resource cleanup did not drain" } }
  fun pending() = done.count == 1L
}
private fun run(operation: PaliSlhOperation): Any? {
  val completion = SlhCompletion(); operation.run(completion); completion.await()
  check(completion.error == null); return completion.result
}
private fun release(tree: PaliSlhTree) {
  val completion = SlhCompletion(); tree.release(completion); completion.await(); check(completion.error == null)
}
private fun dispose(context: PaliSlhContext) {
  val completion = SlhCompletion(); context.dispose(completion); completion.await(); check(completion.error == null)
}

fun checkSlhResourceOwnership(app: Context) {
  val namespace = "0x" + "23".repeat(32)
  val owner = PaliSlhOperationOwner()
  val directory = File(app.noBackupFilesDir, "PaliSlhCache/${namespace.drop(2)}")
  val id = "SLH-DSA-SHA2-128-24:0x" + "00".repeat(32) + ":0x" + "00".repeat(32)
  val initial = PaliSlhContext(app, namespace, owner)
  val published = run(initial.allocateTree()) as PaliSlhTree
  run(initial.publishTree(published, id)); release(published); dispose(initial)
  check(directory.listFiles()!!.single().extension == "xmss")
  val bodyField = PaliSlhOperation::class.java.getDeclaredField("body").apply { isAccessible = true }

  for ((load, closeContext) in listOf(false to false, true to false, false to true)) {
    val context = PaliSlhContext(app, namespace, owner)
    val original = if (load) context.loadTree(id) else context.allocateTree()
    @Suppress("UNCHECKED_CAST")
    val exactBody = bodyField.get(original) as (List<ByteArray>) -> Any?
    val created = CountDownLatch(1); val resume = CountDownLatch(1)
    var output: PaliSlhTree? = null
    val held = PaliSlhOperation(context, null, false, emptyList()) { input ->
      // Reuse the original production body, including its resource inventory.
      exactBody(input).also {
        output = it as PaliSlhTree; created.countDown()
        check(resume.await(20, TimeUnit.SECONDS))
      }
    }
    val completion = SlhCompletion(); held.run(completion)
    check(created.await(20, TimeUnit.SECONDS))
    val descriptor = output!!.descriptor
    check(SlhResourceNative.descriptorOpen(descriptor))
    check(!owner.beginPurge(namespace))
    val closing = if (closeContext) SlhCompletion().also { context.dispose(it) } else null
    held.cancel()
    check(completion.pending()); check(closing?.pending() != false)
    check(SlhResourceNative.descriptorOpen(descriptor)) // Never free a running body's resource.
    output = null
    resume.countDown(); completion.await(); closing?.await()
    check(completion.error == "ERR_SLH_EXECUTION" && completion.result == null)
    check(!SlhResourceNative.descriptorOpen(descriptor)) { "Undelivered tree leaked its FD" }
    check(directory.listFiles()!!.none { it.extension == "partial" }) { "Canceled allocation leaked its owned partial" }
    check(directory.listFiles()!!.single().extension == "xmss") // Loaded public cache survives.
    if (!closeContext) {
      check(!context.isRetired())
      val healthy = run(context.allocateTree()) as PaliSlhTree
      release(healthy); dispose(context)
    }
    check(owner.beginPurge(namespace)); owner.endPurge(namespace, true)
  }
  val purge = PaliSlhCachePurge(app, namespace, owner)
  val completion = SlhCompletion(); purge.run(completion); completion.await()
  check(completion.error == null && directory.listFiles()!!.isEmpty())
  println("3 exact native allocation/load cancellation resource controls passed; no crypto/device qualification")
}
