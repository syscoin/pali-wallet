package org.syscoin.pali.storage
import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.system.Node
import android.system.Os

private val uri = Uri.parse("content://qa/tree/root/document/child")
private fun envelope(): ByteArray = ByteArray(80).also { bytes -> "PALINOTE".encodeToByteArray().copyInto(bytes); for (i in 8..10) bytes[i] = 1; bytes[59] = 16 }
private class Provider(val preexisting: ByteArray = byteArrayOf(), val wrongDevAt: Int = 0, val wrongInoAt: Int = 0, val corruptReadback: Boolean = false): ContentResolver() {
 val node = Node(preexisting.copyOf()); val modes = mutableListOf<String>(); var creates = 0
 override fun create(parent: Uri): Uri { creates++; return uri }
 override fun openFileDescriptor(uri: Uri, mode: String, signal: CancellationSignal): ParcelFileDescriptor {
  signal.throwIfCanceled(); check(mode == "r" || mode == "rw") { "Truncating or unexpected open" }; modes.add(mode)
  if (corruptReadback && modes.size == 3) node.bytes[79] = 42
  // Model Android's read-only FUSE view versus writable underlying-file view.
  val dev = if (modes.size == wrongDevAt) 93L else if (mode == "r") 65068L else 92L
  val ino = if (modes.size == wrongInoAt) 229420L else 229419L
  return ParcelFileDescriptor(Os.attach(node, dev, ino, mode))
 }
}
private fun destination(provider: Provider): PaliNoteBackupSaf.Destination {
 val permit = PaliNoteBackupDestinationPermit(Any(), 100); check(permit.begin(100))
 return PaliNoteBackupSaf.Destination(permit, Context(provider), Uri.parse("content://qa/tree/root"), Uri.parse("content://qa/tree/root/document/root"))
}
private fun rejected(expected: PaliNoteBackupFileError, action: () -> Unit) { try { action(); error("Unexpected acceptance") } catch (e: PaliNoteBackupFileException) { check(e.error == expected) { "Wrong refusal: ${e.error}" } } }
private fun checkCase(name: String, run: () -> Unit) { Os.reset(); run(); println("PASS $name") }
fun main() {
 checkCase("export pins one nontruncating access mode across independent descriptors") { val p = Provider(); val result = PaliNoteBackupSaf.write(destination(p), envelope(), CancellationSignal(), {}); check(result.contentEquals(envelope())); check(p.modes == listOf("rw", "rw", "rw")); check(Os.writes == 1 && Os.syncs == 1) }
 checkCase("import remains read only") { val p = Provider(envelope()); check(PaliNoteBackupSaf.read(Context(p), uri, CancellationSignal(), {}).contentEquals(envelope())); check(p.modes == listOf("r")); check(Os.writes == 0 && Os.syncs == 0) }
 checkCase("different writable device still refuses before writing") { val p = Provider(wrongDevAt = 2); rejected(PaliNoteBackupFileError.WRITE_UNCONFIRMED) { PaliNoteBackupSaf.write(destination(p), envelope(), CancellationSignal(), {}) }; check(Os.writes == 0) }
 checkCase("different writable inode still refuses before writing") { val p = Provider(wrongInoAt = 2); rejected(PaliNoteBackupFileError.WRITE_UNCONFIRMED) { PaliNoteBackupSaf.write(destination(p), envelope(), CancellationSignal(), {}) }; check(Os.writes == 0) }
 checkCase("nonempty created destination is never truncated") { val p = Provider(envelope()); rejected(PaliNoteBackupFileError.WRITE_UNCONFIRMED) { PaliNoteBackupSaf.write(destination(p), envelope(), CancellationSignal(), {}) }; check(Os.writes == 0); check(p.node.bytes.contentEquals(envelope())) }
 checkCase("independent readback retains exact device check") { val p = Provider(wrongDevAt = 3); rejected(PaliNoteBackupFileError.WRITE_UNCONFIRMED) { PaliNoteBackupSaf.write(destination(p), envelope(), CancellationSignal(), {}) }; check(Os.writes == 1) }
 checkCase("independent readback rejects different content") { val p = Provider(corruptReadback = true); rejected(PaliNoteBackupFileError.WRITE_UNCONFIRMED) { PaliNoteBackupSaf.write(destination(p), envelope(), CancellationSignal(), {}) } }
 checkCase("owner cancellation after write cannot acknowledge success") { val p = Provider(); var live = true; Os.afterWrite = { live = false }; rejected(PaliNoteBackupFileError.UNAVAILABLE) { PaliNoteBackupSaf.write(destination(p), envelope(), CancellationSignal()) { if (!live) throw PaliNoteBackupFileException(PaliNoteBackupFileError.UNAVAILABLE) } }; check(Os.syncs == 0) }
 println("SAF export/import mode and retained-guard checks passed: 8")
}
