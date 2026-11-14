#!/usr/bin/env python3
"""Bounded actual-SAF JVM regression using Android API fakes, not device qualification."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

test_dir = Path(__file__).resolve().parent
native = test_dir.parent / 'android/src/main/java/org/syscoin/pali/storage'
java = Path(os.environ['JAVA_HOME']) / 'bin/java'
compiler = Path(os.environ['KOTLIN_COMPILER_LIB'])
if not (compiler / 'kotlin-compiler-embeddable-2.3.0.jar').is_file():
    raise RuntimeError('Use the existing pinned Gradle Kotlin 2.3.0 compiler')
classpath = os.pathsep.join(str(p) for p in sorted(compiler.glob('*.jar')))
# These fakes vary descriptor identity by access mode without changing the production
# SAF, framing, permit, empty-file, write, fsync or independent-readback algorithms.
STUBS = {
    'app.kt': """package android.app
object Activity { const val RESULT_OK = -1 }
""",
    'content.kt': """package android.content
import android.net.Uri
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.database.Cursor
open class ContentResolver {
 open fun openFileDescriptor(uri: Uri, mode: String, signal: CancellationSignal): ParcelFileDescriptor? = error("unexpected open")
 open fun query(uri: Uri, fields: Array<String>, a: String?, b: Array<String>?, c: String?, signal: CancellationSignal): Cursor? = error("unexpected query")
 open fun create(parent: Uri): Uri = error("unexpected create")
}
class Context(val contentResolver: ContentResolver)
class ClipData(val itemCount: Int = 0) { class Item(val uri: Uri?); fun getItemAt(i: Int) = Item(null) }
class Intent(val action: String) {
 var flags = 0; var data: Uri? = null; var clipData: ClipData? = null; var type: String? = null
 fun addFlags(value: Int): Intent { flags = flags or value; return this }; fun addCategory(value: String) = this; fun putExtra(key: String, value: Boolean) = this
 companion object { const val FLAG_GRANT_READ_URI_PERMISSION = 1; const val FLAG_GRANT_WRITE_URI_PERMISSION = 2; const val FLAG_GRANT_PREFIX_URI_PERMISSION = 4; const val ACTION_OPEN_DOCUMENT_TREE = "tree"; const val ACTION_OPEN_DOCUMENT = "document"; const val CATEGORY_OPENABLE = "open"; const val EXTRA_ALLOW_MULTIPLE = "multiple" }
}
""",
    'cursor.kt': """package android.database
interface Cursor: java.io.Closeable { fun moveToFirst(): Boolean; fun getString(index: Int): String; fun getInt(index: Int): Int; fun getColumnIndexOrThrow(field: String): Int }
""",
    'uri.kt': """package android.net
class Uri(private val value: String) {
 private val parsed = java.net.URI(value)
 val scheme get() = parsed.scheme; val encodedAuthority get() = parsed.rawAuthority; val encodedPath get() = parsed.rawPath; val encodedQuery get() = parsed.rawQuery; val encodedFragment get() = parsed.rawFragment
 override fun toString() = value
 companion object { fun parse(value: String) = Uri(value) }
}
""",
    'os.kt': """package android.os
class CancellationSignal { private var cancelled = false; fun cancel() { cancelled = true }; fun throwIfCanceled() { check(!cancelled) } }
object SystemClock { fun elapsedRealtime() = 100L }
class ParcelFileDescriptor(val fileDescriptor: java.io.FileDescriptor): java.io.Closeable { override fun close() {} }
""",
    'documents.kt': """package android.provider
import android.content.ContentResolver
import android.content.Context
import android.net.Uri
object DocumentsContract {
 object Document { const val COLUMN_MIME_TYPE = "mime"; const val COLUMN_FLAGS = "flags"; const val MIME_TYPE_DIR = "directory"; const val FLAG_DIR_SUPPORTS_CREATE = 1 }
 fun getTreeDocumentId(uri: Uri) = uri.encodedPath.split('/')[2]
 fun getDocumentId(uri: Uri) = uri.encodedPath.substringAfterLast('/')
 fun isDocumentUri(context: Context, uri: Uri) = uri.encodedPath.contains("/document/")
 fun buildDocumentUriUsingTree(uri: Uri, id: String) = Uri.parse("content://qa/tree/$id/document/$id")
 fun createDocument(resolver: ContentResolver, parent: Uri, mime: String, name: String): Uri = resolver.create(parent)
}
""",
    'system.kt': """package android.system
import java.io.FileDescriptor
class ErrnoException(val errno: Int): Exception()
class StructStat(val st_mode: Int, val st_dev: Long, val st_ino: Long, val st_size: Long)
object OsConstants { const val EINTR = 4; fun S_ISREG(mode: Int) = mode == 32768 }
class Node(var bytes: ByteArray = byteArrayOf())
data class Handle(val node: Node, val dev: Long, val ino: Long, val mode: String)
object Os {
 val handles = java.util.IdentityHashMap<FileDescriptor, Handle>(); var writes = 0; var syncs = 0; var afterWrite: (() -> Unit)? = null
 fun attach(node: Node, dev: Long, ino: Long, mode: String): FileDescriptor { val fd = FileDescriptor(); handles[fd] = Handle(node, dev, ino, mode); return fd }
 fun fstat(fd: FileDescriptor): StructStat { val h = handles[fd]!!; return StructStat(32768, h.dev, h.ino, h.node.bytes.size.toLong()) }
 fun pread(fd: FileDescriptor, out: ByteArray, offset: Int, count: Int, position: Long): Int { val b = handles[fd]!!.node.bytes; val length = minOf(count, maxOf(0, b.size - position.toInt())); b.copyInto(out, offset, position.toInt(), position.toInt() + length); return length }
 fun pwrite(fd: FileDescriptor, bytes: ByteArray, offset: Int, count: Int, position: Long): Int { val h = handles[fd]!!; check(h.mode == "rw"); val end = position.toInt() + count; if (h.node.bytes.size < end) h.node.bytes = h.node.bytes.copyOf(end); bytes.copyInto(h.node.bytes, position.toInt(), offset, offset + count); writes++; afterWrite?.invoke(); return count }
 fun fsync(fd: FileDescriptor) { check(handles.containsKey(fd)); syncs++ }
 fun reset() { handles.clear(); writes = 0; syncs = 0; afterWrite = null }
}
""",
}
scratch = Path(tempfile.mkdtemp(prefix='pali-note-backup-saf-'))
try:
    for name, text in STUBS.items():
        (scratch / name).write_text(text)
    subprocess.run([str(java), '-Xmx256m', '-XX:ActiveProcessorCount=1', '-cp', classpath,
                    'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-classpath', classpath,
                    '-d', str(scratch / 'classes'), *map(str, scratch.glob('*.kt')),
                    str(native / 'PaliNoteBackupSaf.kt'), str(native / 'PaliNoteBackupFile.kt'),
                    str(native / 'PaliNoteBackupDestinationPermit.kt'), str(test_dir / 'NoteBackupAndroidSafChecks.kt')],
                   check=True, timeout=60)
    subprocess.run([str(java), '-Xmx128m', '-XX:ActiveProcessorCount=1', '-cp',
                    str(scratch / 'classes') + os.pathsep + classpath, 'org.syscoin.pali.storage.NoteBackupAndroidSafChecksKt'],
                   check=True, timeout=20)
except subprocess.CalledProcessError as error:
    raise SystemExit(error.returncode) from None
except subprocess.TimeoutExpired:
    raise SystemExit('Bounded SAF regression timed out') from None
finally:
    shutil.rmtree(scratch)
