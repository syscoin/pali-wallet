#!/usr/bin/env python3
"""Run only the platform-independent passkey policy/ticket tests, without an app build."""

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request


# Public Maven Central artifacts, pinned for this isolated test runner.
ARTIFACTS = [
    ("org.jetbrains.kotlin", "kotlin-compiler-embeddable", "2.2.0", "b2f743ea5ba12f69e0f35e5d8d46069d74c8e2861087548a7e0e14a784bc4cf1"),
    ("org.jetbrains.kotlin", "kotlin-stdlib", "2.2.0", "65d12d85a3b865c160db9147851712a64b10dadd68b22eea22a95bf8a8670dca"),
    ("org.jetbrains.kotlin", "kotlin-script-runtime", "2.2.0", "4ed97fd1e0c9bb1d0948ed5e63cc91456313a59518295b92b2c1514aef556150"),
    ("org.jetbrains.kotlin", "kotlin-daemon-embeddable", "2.2.0", "a26cc8e2d8619197cc4d115bea7766e9aa8e0f1e7876ea044ee1b9f305654601"),
    ("org.jetbrains.kotlin", "kotlin-reflect", "1.6.10", "3277ac102ae17aad10a55abec75ff5696c8d109790396434b496e75087854203"),
    ("org.jetbrains.kotlinx", "kotlinx-coroutines-core-jvm", "1.8.0", "9860906a1937490bf5f3b06d2f0e10ef451e65b95b269f22daf68a3d1f5065c5"),
    ("org.jetbrains", "annotations", "13.0", "ace2a10dc8e2d5fd34925ecac03e4988b2c0f851650c94b8cef49ba1bd111478"),
    ("junit", "junit", "4.13.2", "8e495b634469d64fb8acfa3495a065cbacc8a0fff55ce1e31007be4c16dc57d3"),
    ("org.hamcrest", "hamcrest-core", "1.3", "66fdef91e9739348df7a096aa384a5685f4e875584cce89386a7a47251c4d8e9"),
    ("org.json", "json", "20250517", "3ea61b2a06e31edf1c91134fe9106b0ebb16628be169f3db75bc7a2b06b45796"),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--java", default=str(Path(os.environ["JAVA_HOME"]) / "bin/java") if "JAVA_HOME" in os.environ else shutil.which("java"))
    parser.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "pali-passkeys-jvm")
    parser.add_argument("--download", action="store_true", help="Allow missing pinned test jars to be downloaded from Maven Central")
    parser.add_argument("--log", type=Path)
    args = parser.parse_args()
    if not args.java:
        parser.error("A Java 17+ runtime is required; provide --java or JAVA_HOME")
    args.cache.mkdir(parents=True, exist_ok=True)
    jars = {}
    for group, name, version, digest in ARTIFACTS:
        filename = f"{name}-{version}.jar"
        path = args.cache / filename
        if not path.exists():
            if not args.download:
                parser.error(f"Missing {path}; rerun with --download or populate the cache")
            url = f"https://repo.maven.apache.org/maven2/{group.replace('.', '/')}/{name}/{version}/{filename}"
            with urllib.request.urlopen(url, timeout=60) as response:
                data = response.read(80 * 1024 * 1024 + 1)
            if len(data) > 80 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != digest:
                parser.error(f"Checksum/size mismatch for {filename}")
            path.write_bytes(data)
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            parser.error(f"Checksum mismatch for {path}")
        jars[name] = path
    compiler = os.pathsep.join(str(jars[name]) for name in (
        "kotlin-compiler-embeddable", "kotlin-stdlib", "kotlin-script-runtime", "kotlin-daemon-embeddable",
        "kotlin-reflect", "kotlinx-coroutines-core-jvm", "annotations"))
    runtime = os.pathsep.join(str(jars[name]) for name in ("kotlin-stdlib", "junit", "hamcrest-core", "annotations", "json"))
    root = Path(__file__).resolve().parent
    sources = [root / f"src/{kind}/java/org/syscoin/pali/passkeys/{name}.kt" for kind, name in (
        ("main", "PaliPasskeyPolicy"), ("main", "PaliPasskeyTickets"),
        ("test", "PaliPasskeyPolicyTest"), ("test", "PaliPasskeyTicketsTest"))]
    output = []
    with tempfile.TemporaryDirectory(prefix="pali-passkeys-classes-") as classes:
        commands = [
            [args.java, "-cp", compiler, "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", "-no-stdlib", "-no-reflect",
             "-jvm-target", "17", "-classpath", runtime, "-d", classes, *map(str, sources)],
            [args.java, "-cp", classes + os.pathsep + runtime, "org.junit.runner.JUnitCore",
             "org.syscoin.pali.passkeys.PaliPasskeyPolicyTest", "org.syscoin.pali.passkeys.PaliPasskeyTicketsTest"],
        ]
        for command in commands:
            result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
            print(result.stdout, end="")
            output.append(result.stdout)
            if args.log:
                args.log.write_text("".join(output))
            if result.returncode:
                return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
