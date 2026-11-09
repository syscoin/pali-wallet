package expo.modules.paliwalletcrypto

import android.content.Context
import expo.modules.kotlin.Promise
import expo.modules.kotlin.sharedobjects.SharedObject
import java.lang.ref.WeakReference
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

internal const val SLH_TREE_BYTES = 134_217_712
private const val SLH_LEAVES = 4_194_304
internal fun slhHex(value: String, size: Int): ByteArray {
  require(value.length == 2 + size * 2 && value.startsWith("0x"))
  val output = ByteArray(size)
  fun nibble(c: Char): Int = when (c) { in '0'..'9' -> c.code - 48; in 'a'..'f' -> c.code - 87; else -> throw IllegalArgumentException() }
  try { for (i in output.indices) output[i] = ((nibble(value[2 + i * 2]) shl 4) or nibble(value[3 + i * 2])).toByte(); return output }
  catch (error: Throwable) { output.fill(0); throw error }
}
private fun slhText(bytes: ByteArray): String = "0x" + bytes.joinToString("") { "%02x".format(it.toInt() and 255) }
private fun index(value: Double, low: Int, high: Int): Int {
  require(value.isFinite() && value % 1.0 == 0.0 && value >= low && value <= high)
  return value.toInt()
}
private fun expectedRoot(keyId: String): ByteArray {
  val pieces = keyId.split(':'); require(pieces.size == 3 && pieces[0] == "SLH-DSA-SHA2-128-24")
  val seed = slhHex(pieces[1], 32); val root = slhHex(pieces[2], 32)
  require(seed.drop(16).all { it == 0.toByte() } && root.drop(16).all { it == 0.toByte() })
  return root.copyOfRange(0, 16)
}

internal class PaliSlhFiles(app: Context, namespace: String) {
  private val base = app.noBackupFilesDir.canonicalPath
  private val namespace = namespace.also { slhHex(it, 32).fill(0) }
  private var directory = PaliSlhNative.openNamespace(base, namespace, true).also { check(it >= 0) }
  private fun name(keyId: String): String = MessageDigest.getInstance("SHA-256").digest(keyId.encodeToByteArray()).joinToString("") { "%02x".format(it.toInt() and 255) } + ".xmss"
  fun allocate(context: PaliSlhContext): PaliSlhTree {
    context.check()
    val leaf = UUID.randomUUID().toString().replace("-", "") + ".partial"
    val fd = PaliSlhNative.openTree(directory, leaf, true); check(fd >= 0)
    val tree = PaliSlhTree(context, this, fd, leaf, false)
    try { check(PaliSlhNative.reserveTree(fd)); validate(tree); return tree }
    catch (error: Throwable) {
      val aborted = runCatching { abort(tree) }.isSuccess
      val closed = PaliSlhNative.closeDescriptor(fd)
      if (!aborted || !closed) context.markCleanupFailure()
      throw error
    }
  }
  fun load(context: PaliSlhContext, id: String): PaliSlhTree? {
    val root = expectedRoot(id); context.check()
    val leaf = name(id); val fd = PaliSlhNative.openTree(directory, leaf, false)
    if (fd == -2) return null
    check(fd >= 0)
    val tree = PaliSlhTree(context, this, fd, leaf, true)
    try { validate(tree); check(root.contentEquals(tree.root())); return tree }
    catch (error: Throwable) { if (!PaliSlhNative.closeDescriptor(fd)) context.markCleanupFailure(); throw error }
  }
  fun validate(tree: PaliSlhTree) { check(PaliSlhNative.validateTree(directory, tree.descriptor, tree.name)) }
  fun publish(tree: PaliSlhTree, id: String) {
    check(expectedRoot(id).contentEquals(tree.root())); validate(tree); tree.context.check()
    val target = name(id)
    val result = PaliSlhNative.publishTree(directory, tree.descriptor, tree.name, target, tree)
    if (result > 0) { tree.name = target; tree.published = true }
    check(result == 1); validate(tree); tree.check()
  }
  fun abort(tree: PaliSlhTree) { if (!tree.published) check(PaliSlhNative.abortTree(directory, tree.descriptor, tree.name)) }
  fun close() { if (directory >= 0) { val fd = directory; directory = -1; check(PaliSlhNative.closeDescriptor(fd)) } }
  companion object {
    fun purge(app: Context, namespace: String, operation: PaliSlhCachePurge): Pair<Boolean, Boolean> {
      // The deletion-only operation captures no file descriptor before confirmed removal.
      if (!operation.isCurrentForSlhIO()) return false to true
      val fd = PaliSlhNative.openNamespace(app.noBackupFilesDir.canonicalPath, namespace, false)
      if (fd == -2) return true to true
      if (fd < 0) return false to true
      var result = 0
      var clean = true
      try { result = PaliSlhNative.purgeTrees(fd, operation) }
      finally { clean = PaliSlhNative.closeDescriptor(fd) }
      return (result == 1 && clean) to (result >= 0 && clean)
    }
  }
}

class PaliSlhTree internal constructor(
  internal val context: PaliSlhContext, private val files: PaliSlhFiles,
  internal val descriptor: Int, internal var name: String, internal var published: Boolean
) : SharedObject() {
  private val retired = AtomicBoolean(false)
  private val mappingGood = AtomicBoolean(true)
  private val mapping = ReentrantLock()
  private var released = false
  private var cleanupGood = true
  internal fun check() { check(!retired.get() && mappingGood.get()); context.check() }
  @androidx.annotation.Keep fun isCurrentForSlhIO(): Boolean = runCatching { check() }.isSuccess
  @androidx.annotation.Keep fun markSlhMappingFailure() { mappingGood.set(false); context.markCleanupFailure(); context.close() }
  internal fun root(): ByteArray { check(); files.validate(this); return checkNotNull(PaliSlhNative.readTreeRoot(descriptor)).also { check(it.size == 16); check() } }
  internal fun <T> access(write: Boolean, body: (Int) -> T): T = mapping.withLock {
    check(!retired.get() && (!write || !published)); context.check(); files.validate(this)
    body(descriptor).also { check(); files.validate(this) }
  }
  internal fun release(promise: Promise? = null, complete: ((Boolean) -> Unit)? = null) {
    retired.set(true)
    PaliSlhLeafWorker.cleanup {
      val good = runCatching { mapping.withLock {
        if (!released) {
          try { files.abort(this) } finally { released = true; check(PaliSlhNative.closeDescriptor(descriptor)) }
        }
      } }.isSuccess && cleanupGood && mappingGood.get()
      cleanupGood = good
      context.releaseTreeOwnership(this, good)
      if (good) promise?.resolve() else promise?.reject("ERR_SLH_EXECUTION", "Native SLH execution unavailable", null)
      complete?.invoke(good)
    }
  }
  override fun sharedObjectDidRelease() { release() }
}

class PaliSlhContext internal constructor(
  app: Context, private val namespace: String, private val owner: PaliSlhOperationOwner
) : SharedObject() {
  private val crypto = PaliCryptoContext()
  private val files: PaliSlhFiles
  private var closed = false
  private var active = 0
  private var disposing = false
  private var disposed = false
  private var disposalGood = true
  private val waiters = mutableListOf<Promise>()
  private val operations = mutableListOf<WeakReference<PaliSlhOperation>>()
  private val trees = mutableListOf<PaliSlhTree>()
  init {
    slhHex(namespace, 32).fill(0); check(owner.openNamespace(namespace))
    try { files = PaliSlhFiles(app, namespace) }
    catch (error: Throwable) { owner.closeNamespace(namespace, true); throw error }
    val weak = WeakReference(this); owner.onRetire { weak.get()?.close() }
  }
  @Synchronized internal fun check() { check(!closed && owner.isOpen); crypto.ensureOpen() }
  @Synchronized internal fun isRetired(): Boolean = closed
  @Synchronized internal fun markCleanupFailure() { disposalGood = false }
  internal fun releaseTreeOwnership(tree: PaliSlhTree, clean: Boolean) {
    synchronized(this) { trees.removeAll { it === tree }; disposalGood = disposalGood && clean }
    if (!clean) close()
  }
  internal fun checkMaterial(value: PaliCryptoKey, seed: Boolean) {
    check(); check(value.isUsable(crypto, if (seed) "SLH-DSA-SEED" else "SLH-DSA-SK", if (seed) "derivePublic" else "sign"))
  }
  @androidx.annotation.Keep fun isCurrentForSlhIO(): Boolean = runCatching { check() }.isSuccess
  internal fun importMaterial(value: String, seed: Boolean): PaliCryptoKey {
    check(); val bytes = slhHex(value, if (seed) 48 else 64)
    return try { crypto.registerSlhMaterial(bytes, seed) } finally { bytes.fill(0) }
  }
  private fun key(value: PaliCryptoKey, seed: Boolean): ByteArray {
    check(); return value.copyMaterial(crypto, if (seed) "SLH-DSA-SEED" else "SLH-DSA-SK", if (seed) "derivePublic" else "sign")
  }
  @Synchronized internal fun begin() { check(); active++ }
  internal fun end() { val done = synchronized(this) { active--; closed && active == 0 }; if (done) finishDisposal() }
  internal fun close() {
    val live = synchronized(this) { closed = true; operations.mapNotNull { it.get() } }
    crypto.close(); live.forEach { it.cancel() }; finishDisposal()
  }
  internal fun dispose(promise: Promise) {
    val done = synchronized(this) { if (disposed) true else { waiters.add(promise); false } }
    if (done) { finishPromise(promise); return }; close()
  }
  private fun finishPromise(promise: Promise) { if (disposalGood) promise.resolve() else promise.reject("ERR_SLH_EXECUTION", "Native SLH execution unavailable", null) }
  private fun finishDisposal() {
    val live = synchronized(this) {
      if (!closed || active != 0 || disposing || disposed) return
      disposing = true; trees.toList().also { trees.clear() }
    }
    val remaining = java.util.concurrent.atomic.AtomicInteger(live.size + 1)
    fun finish(good: Boolean) {
      val callbacks = synchronized(this) {
        disposalGood = disposalGood && good
        if (remaining.decrementAndGet() != 0) return
        val filesClosed = runCatching { files.close() }.isSuccess
        disposalGood = disposalGood && filesClosed
        owner.closeNamespace(namespace, disposalGood)
        disposed = true; waiters.toList().also { waiters.clear() }
      }
      callbacks.forEach { finishPromise(it) }
    }
    live.forEach { it.release(complete = ::finish) }; finish(true)
  }
  private fun tree(value: PaliSlhTree) { check(); check(value.context === this) }
  private fun operation(bytes: List<ByteArray> = emptyList(), material: PaliCryptoKey?, seed: Boolean = false, body: (List<ByteArray>) -> Any?): PaliSlhOperation {
    check(); val operation = PaliSlhOperation(this, material, seed, bytes, body)
    synchronized(this) { check(!closed); operations.removeAll { it.get() == null }; operations.add(WeakReference(operation)) }
    return operation
  }
  internal fun allocateTree() = operation(material = null) { val tree = files.allocate(this); synchronized(this) { trees.add(tree) }; tree }
  internal fun loadTree(id: String): PaliSlhOperation {
    expectedRoot(id); return operation(material = null) { files.load(this, id).also { if (it != null) synchronized(this) { trees.add(it) } } }
  }
  internal fun publishTree(value: PaliSlhTree, id: String): PaliSlhOperation {
    tree(value); expectedRoot(id); return operation(material = null) { tree(value); files.publish(value, id); null }
  }
  internal fun readTreeRoot(value: PaliSlhTree): PaliSlhOperation { tree(value); return operation(material = null) { tree(value); slhText(value.root()) } }
  internal fun writeTreeLeaves(value: PaliSlhTree, start: Double, hex: String): PaliSlhOperation {
    tree(value); val count = (hex.length - 2) / 32; require(count in 1..8192)
    val first = index(start, 0, SLH_LEAVES - count); val bytes = slhHex(hex, count * 16)
    return operation(listOf(bytes), material = null) { input -> value.access(true) { fd -> check(PaliSlhNative.writeTreeLeaves(fd, first, input[0])) }; null }
  }
  internal fun treeChunk(seed: PaliCryptoKey, value: PaliSlhTree, level: Double, start: Double, count: Double): PaliSlhOperation {
    tree(value); val height = index(level, 0, 22); val size = index(count, 1, 8192); val first = index(start, 0, (SLH_LEAVES shr height) - size)
    return operation(material = seed, seed = true) { val bytes = key(seed, true); try { value.access(true) { fd -> check(PaliSlhNative.treeChunk(bytes, fd, height, first, size, value) == size) }; size } finally { bytes.fill(0) } }
  }
  internal fun leafChunk(seed: PaliCryptoKey, start: Double, count: Double): PaliSlhOperation {
    val size = index(count, 1, 8192); val first = index(start, 0, SLH_LEAVES - size)
    return operation(material = seed, seed = true) { val bytes = key(seed, true); try {
      val result = checkNotNull(PaliSlhNative.leafChunk(bytes, first, size)); try { check(result.size == size * 16); slhText(result) } finally { result.fill(0) }
    } finally { bytes.fill(0) } }
  }
  private fun message(hex: String): ByteArray {
    val bytes = slhHex(hex, 34)
    try { require(bytes[0] == 0.toByte() && bytes[1] == 0.toByte()); return bytes.copyOfRange(2, 34) } finally { bytes.fill(0) }
  }
  internal fun prepareVerify(publicKey: String, action: String, signature: String) = operation(listOf(slhHex(publicKey, 32), slhHex(action, 32), slhHex(signature, 3856)), material = null) { input ->
    when (PaliSlhNative.verify(input[0], input[1], input[2])) { 1 -> true; 0 -> false; else -> error("Native SLH execution unavailable") }
  }
  private fun signing(key: PaliCryptoKey, bytes: List<ByteArray>, length: Int, body: (ByteArray, List<ByteArray>) -> ByteArray?) = operation(bytes, material = key) { input ->
    val material = this.key(key, false)
    try { val result = checkNotNull(body(material, input)); try { check(result.size == length); slhText(result) } finally { result.fill(0) } }
    finally { material.fill(0) }
  }
  internal fun prelude(key: PaliCryptoKey, text: String, random: String) = signing(key, listOf(message(text), slhHex(random, 16)), 46) { material, input -> PaliSlhNative.prelude(material, input[0], input[1]) }
  internal fun fors(key: PaliCryptoKey, text: String, treeIndex: Double): PaliSlhOperation {
    val number = index(treeIndex, 0, 5)
    return signing(key, listOf(slhHex(text, 46)), 416) { material, input -> PaliSlhNative.fors(material, input[0], number) }
  }
  internal fun cached(key: PaliCryptoKey, text: String, random: String, value: PaliSlhTree): PaliSlhOperation {
    tree(value); return signing(key, listOf(message(text), slhHex(random, 16)), 3856) { material, input -> value.access(false) { fd -> PaliSlhNative.cached(material, input[0], input[1], fd, value) } }
  }
  internal fun finish(key: PaliCryptoKey, text: String, prefix: String, fors: String, roots: String, value: PaliSlhTree): PaliSlhOperation {
    tree(value); return signing(key, listOf(message(text), slhHex(prefix, 46), slhHex(fors, 2400), slhHex(roots, 96)), 3856) { material, input -> value.access(false) { fd -> PaliSlhNative.finish(material, input[0], input[1], input[2], input[3], fd, value) } }
  }
  override fun sharedObjectDidRelease() { close() }
}

/** No key/context/FD is captured until this confirmed-removal operation runs. */
class PaliSlhCachePurge internal constructor(
  private val app: Context, private val namespace: String, private val owner: PaliSlhOperationOwner
) : SharedObject() {
  private val started = AtomicBoolean(false)
  private val cancelled = AtomicBoolean(false)
  init {
    slhHex(namespace, 32).fill(0)
    val weak = WeakReference(this); owner.onRetire { weak.get()?.cancel() }
  }
  internal fun cancel() { cancelled.set(true) }
  @androidx.annotation.Keep fun isCurrentForSlhIO(): Boolean = !cancelled.get() && owner.isOpen
  internal fun run(promise: Promise) {
    if (!started.compareAndSet(false, true) || !isCurrentForSlhIO() || !owner.beginPurge(namespace)) { reject(promise); return }
    val accepted = PaliSlhLeafWorker.enqueue({
      try { PaliSlhFiles.purge(app, namespace, this) } catch (_: Throwable) { false to false }
    }, { result ->
      owner.endPurge(namespace, result.second)
      if (result.first && isCurrentForSlhIO()) promise.resolve() else reject(promise)
    })
    if (!accepted) { owner.endPurge(namespace, true); reject(promise) }
  }
  private fun reject(promise: Promise) { promise.reject("ERR_SLH_EXECUTION", "Native SLH execution unavailable", null) }
  override fun sharedObjectDidRelease() { cancel() }
}

class PaliSlhOperation internal constructor(
  private val context: PaliSlhContext, private val material: PaliCryptoKey?, private val seed: Boolean,
  private val bytes: List<ByteArray>, private val body: (List<ByteArray>) -> Any?
) : SharedObject() {
  private val started = AtomicBoolean(false)
  private val cancelled = AtomicBoolean(false)
  internal fun cancel() { cancelled.set(true) }
  private fun check() { check(!cancelled.get()); context.check(); material?.let { context.checkMaterial(it, seed) } }
  internal fun run(promise: Promise) {
    try { check(started.compareAndSet(false, true)); check(); context.begin() }
    catch (_: Throwable) { reject(promise); return }
    val accepted = PaliSlhLeafWorker.enqueue({
      var produced: Any? = null
      try { check(); produced = body(bytes); check(); Result.success(produced) to null }
      catch (error: Throwable) { Result.failure<Any?>(error) to (produced as? PaliSlhTree) }
      finally { bytes.forEach { it.fill(0) } }
    }, { outcome ->
      context.end()
      try { check(); promise.resolve(outcome.first.getOrThrow()) }
      catch (_: Throwable) {
        val tree = outcome.second ?: (outcome.first.getOrNull() as? PaliSlhTree)
        // C/body has returned; never rely on Expo GC for an undelivered output.
        if (tree != null) tree.release(complete = { reject(promise) }) else reject(promise)
      }
    })
    if (!accepted) { context.end(); bytes.forEach { it.fill(0) }; reject(promise) }
  }
  private fun reject(promise: Promise) { promise.reject("ERR_SLH_EXECUTION", "Native SLH execution unavailable", null) }
  override fun sharedObjectDidRelease() { cancel() }
}
