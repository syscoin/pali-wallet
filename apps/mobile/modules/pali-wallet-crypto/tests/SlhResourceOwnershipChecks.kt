package expo.modules.paliwalletcrypto

import android.content.Context
import expo.modules.kotlin.Promise
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

private class SlhManualExecutor : Executor {
  val jobs = java.util.ArrayDeque<Runnable>()
  override fun execute(command: Runnable) { jobs.addLast(command) }
  fun next() { jobs.removeFirst().run() }
  fun drain() { while (jobs.isNotEmpty()) next() }
}

private fun checkSlhScheduler() {
  val independent = PaliSlhWorkKind.INDEPENDENT
  val exclusive = PaliSlhWorkKind.EXCLUSIVE
  val rejected = { error("Unexpected dispatch refusal") }
  run {
    val executor = SlhManualExecutor(); val scheduler = PaliSlhScheduler(3, executor)
    val completed = mutableListOf<Int>()
    repeat(8) { index -> check(scheduler.enqueue(independent, { completed.add(index) }, rejected)) }
    check(executor.jobs.size == 3)
    check(!scheduler.enqueue(independent, { error("Ninth normal admission ran") }, rejected))
    executor.drain(); check(completed == (0..7).toList())
    check(scheduler.enqueue(independent, {}, rejected)); executor.drain()
  }
  run {
    val executor = SlhManualExecutor(); val scheduler = PaliSlhScheduler(3, executor)
    val order = mutableListOf<String>()
    check(scheduler.enqueue(independent, { order.add("first") }, rejected))
    check(scheduler.enqueue(independent, { order.add("second") }, rejected))
    check(scheduler.enqueue(exclusive, { order.add("exclusive") }, rejected))
    check(scheduler.enqueue(independent, { order.add("after") }, rejected))
    check(executor.jobs.size == 2)
    executor.next(); check(executor.jobs.size == 1 && order == listOf("first"))
    executor.next(); check(executor.jobs.size == 1 && order == listOf("first", "second"))
    executor.next(); check(executor.jobs.size == 1 && order.last() == "exclusive")
    executor.drain(); check(order == listOf("first", "second", "exclusive", "after"))
  }
  run {
    val executor = SlhManualExecutor(); val scheduler = PaliSlhScheduler(2, executor, 2)
    val order = mutableListOf<String>()
    repeat(2) { index -> check(scheduler.enqueue(independent, { order.add("normal$index") }, rejected)) }
    scheduler.cleanup {
      order.add("cleanup")
      check(!scheduler.enqueue(independent, { error("Admitted before cleanup completed") }, rejected))
    }
    check(!scheduler.enqueue(independent, {}, rejected))
    executor.next(); check(executor.jobs.size == 1)
    executor.next(); check(executor.jobs.size == 1)
    executor.drain(); check(order == listOf("normal0", "normal1", "cleanup"))
    check(scheduler.enqueue(independent, {}, rejected)); executor.drain()
  }
  run {
    val executor = SlhManualExecutor(); val scheduler = PaliSlhScheduler(1, executor, 1)
    val bytes = ByteArray(4) { 7 }
    check(scheduler.enqueue(independent, {
      bytes.fill(0)
      // Completion and input cleanup are still charged to the worker slot.
      check(!scheduler.enqueue(independent, {}, rejected))
      scheduler.cleanup { check(bytes.all { it == 0.toByte() }) }
    }, rejected))
    executor.drain(); check(scheduler.enqueue(independent, {}, rejected)); executor.drain()
  }
  run {
    var refusals = 0; var cleanups = 0
    val scheduler = PaliSlhScheduler(2, Executor { throw RejectedExecutionException() })
    repeat(10) { check(scheduler.enqueue(independent, { error("Rejected work ran") }, { refusals++ })) }
    scheduler.cleanup { cleanups++ }
    check(refusals == 10 && cleanups == 1)
    check(scheduler.enqueue(exclusive, {}, { refusals++ })); check(refusals == 11)
  }
  run {
    val executor = Executors.newFixedThreadPool(3)
    val scheduler = PaliSlhScheduler(3, executor)
    val started = CountDownLatch(3); val release = CountDownLatch(1); val done = CountDownLatch(8)
    val active = AtomicInteger(); val peak = AtomicInteger(); val failures = AtomicInteger()
    try {
      repeat(8) {
        check(scheduler.enqueue(independent, {
          val count = active.incrementAndGet(); peak.updateAndGet { old -> maxOf(old, count) }; started.countDown()
          try { check(release.await(20, TimeUnit.SECONDS)) }
          finally { active.decrementAndGet(); done.countDown() }
        }, { failures.incrementAndGet(); done.countDown() }))
      }
      check(started.await(20, TimeUnit.SECONDS)); check(peak.get() == 3)
      check(!scheduler.enqueue(independent, {}, rejected))
      release.countDown(); check(done.await(20, TimeUnit.SECONDS)); check(failures.get() == 0 && active.get() == 0)
    } finally { release.countDown(); executor.shutdown(); check(executor.awaitTermination(20, TimeUnit.SECONDS)) }
  }
  check(PaliSlhLeafWorker.parallelism == minOf(6, maxOf(1, Runtime.getRuntime().availableProcessors() - 1)))
  println("6 bounded FIFO scheduler controls passed")
}

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
  checkSlhScheduler()
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
  run {
    val context = PaliSlhContext(app, namespace, owner)
    val kind = PaliSlhOperation::class.java.getDeclaredField("kind").apply { isAccessible = true }
    val seed = context.importMaterial("0x" + "01".repeat(48), true)
    val key = context.importMaterial("0x" + "02".repeat(64), false)
    val independent = listOf(context.leafChunk(seed, 0.0, 1.0), context.fors(key, "0x" + "00".repeat(46), 0.0))
    val exclusive = listOf(context.allocateTree(), context.loadTree(id),
      context.prelude(key, "0x" + "00".repeat(34), "0x" + "00".repeat(16)),
      context.prepareVerify("0x" + "00".repeat(32), "0x" + "00".repeat(32), "0x" + "00".repeat(3856)))
    check(independent.all { kind.get(it) == PaliSlhWorkKind.INDEPENDENT })
    check(exclusive.all { kind.get(it) == PaliSlhWorkKind.EXCLUSIVE })
    (independent + exclusive).forEach { it.cancel() }
    val input = ByteArray(8) { 7 }
    val unsent = PaliSlhOperation(context, null, false, listOf(input)) { error("Canceled input used") }
    unsent.cancel(); check(input.all { it == 0.toByte() })
    val refused = SlhCompletion(); unsent.run(refused); refused.await(); check(refused.error == "ERR_SLH_EXECUTION")
    val tree = run(context.allocateTree()) as PaliSlhTree
    val held = CountDownLatch(1); val resume = CountDownLatch(1)
    check(PaliSlhLeafWorker.enqueue(work = { held.countDown(); check(resume.await(20, TimeUnit.SECONDS)) }, complete = {}, rejected = { error("Barrier refused") }))
    check(held.await(20, TimeUnit.SECONDS))
    val first = SlhCompletion(); val second = SlhCompletion()
    tree.release(first); tree.release(second)
    check(first.pending() && second.pending())
    resume.countDown(); first.await(); second.await()
    check(first.error == null && second.error == null)
    val after = SlhCompletion(); tree.release(after); after.await(); check(after.error == null)
    dispose(context)
  }
  val purge = PaliSlhCachePurge(app, namespace, owner)
  val completion = SlhCompletion(); purge.run(completion); completion.await()
  check(completion.error == null && directory.listFiles()!!.isEmpty())
  println("3 exact native allocation/load cancellation controls plus kind, unsent-input and repeated-release controls passed; no crypto/device qualification")
}
