#!/usr/bin/env python3
"""Bounded host-JVM resource check; not an Android app or full crypto build."""
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile

test_dir = Path(__file__).resolve().parent
module = test_dir.parent
java = Path(os.environ['JAVA_HOME'])
compiler = Path(os.environ['KOTLIN_COMPILER_LIB'])
classpath = os.pathsep.join(str(p) for p in sorted(compiler.glob('*.jar')))
if not (compiler / 'kotlin-compiler-embeddable-2.3.0.jar').is_file():
    raise RuntimeError('Use the existing pinned Gradle Kotlin 2.3.0 compiler')
scratch = Path(tempfile.mkdtemp(prefix='pali-slh-resources-'))
try:
    stubs = {
        'Object.kt': 'package expo.modules.kotlin.sharedobjects\nopen class SharedObject { open fun sharedObjectDidRelease() {} ; open fun getAdditionalMemoryPressure(): Int = 0 }',
        'Promise.kt': 'package expo.modules.kotlin\ninterface Promise { fun resolve(value:Any?=null); fun reject(code:String?,message:String?,cause:Throwable?) }',
        'Context.kt': 'package android.content\nopen class Context(val noBackupFilesDir:java.io.File)',
        'Keep.kt': 'package androidx.annotation\nannotation class Keep',
        'Main.kt': 'package expo.modules.paliwalletcrypto\nfun main(args:Array<String>) { checkSlhResourceOwnership(android.content.Context(java.io.File(args.single()))) }',
    }
    source = (module / 'android/src/main/java/expo/modules/paliwalletcrypto/PaliWalletCryptoModule.kt').read_text()
    stubs['Keys.kt'] = 'package expo.modules.paliwalletcrypto\nimport expo.modules.kotlin.sharedobjects.SharedObject\nimport java.lang.ref.WeakReference\n' + source[source.index('class PaliCryptoKey'):source.index('class PaliDecryptResponse')]
    for name, contents in stubs.items():
        (scratch / name).write_text(contents)
    native = module / 'android/src/main/java/expo/modules/paliwalletcrypto'
    subprocess.run([str(java / 'bin/java'), '-Xmx256m', '-XX:ActiveProcessorCount=1', '-cp', classpath,
                    'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-classpath', classpath,
                    '-d', str(scratch / 'classes'), *map(str, scratch.glob('*.kt')),
                    str(native / 'PaliSlhExecution.kt'), str(native / 'PaliSlhLeafOperation.kt'),
                    str(test_dir / 'SlhResourceOwnershipChecks.kt')], check=True, timeout=60)
    mac = platform.system() == 'Darwin'
    library = scratch / ('libpali_slh_engine.dylib' if mac else 'libpali_slh_engine.so')
    subprocess.run([os.environ.get('CC', 'clang'), '-std=c11', '-D_GNU_SOURCE', '-Wall', '-Wextra', '-Werror',
                    '-Wno-unused-parameter', '-fPIC', '-dynamiclib' if mac else '-shared',
                    '-I' + str(java / 'include'), '-I' + str(java / 'include' / ('darwin' if mac else 'linux')),
                    str(test_dir / 'slh-native-resource-jni.c'), '-o', str(library)], check=True, timeout=30)
    private = scratch / 'private'; private.mkdir(mode=0o700)
    subprocess.run([str(java / 'bin/java'), '-Xmx128m', '-XX:ActiveProcessorCount=1',
                    '-Djava.library.path=' + str(scratch), '-cp', str(scratch / 'classes') + os.pathsep + classpath,
                    'expo.modules.paliwalletcrypto.MainKt', str(private)], check=True, timeout=90)
except subprocess.CalledProcessError as error:
    raise SystemExit(error.returncode) from None
except subprocess.TimeoutExpired:
    raise SystemExit('Bounded native resource check timed out') from None
finally:
    # Only this runner's newly created public fixture data, after the JVM drains/exits.
    shutil.rmtree(scratch)
