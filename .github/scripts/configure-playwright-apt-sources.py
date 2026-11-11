#!/usr/bin/env python3
"""Use direct, signed Ubuntu archives for Playwright on hosted Ubuntu 24 x64.

The runner's mirror+file source tries Azure first, so an Azure DNS failure can
prevent installation before browser tests run. Source format checked against:
https://github.com/actions/runner-images/blob/ubuntu24/20261101.360/images/ubuntu/scripts/build/configure-apt-sources.sh
Only the Ubuntu Deb822 URI field changes; apt's trust/cache policy is untouched.
"""

import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import tempfile


KEYRING = "/usr/share/keyrings/ubuntu-archive-keyring.gpg"
MIRRORS = {
    "mirror+file:/etc/apt/apt-mirrors.txt",
    "mirror+file:/etc/apt/apt-security-mirrors.txt",
}
ARCHIVE = "https://archive.ubuntu.com/ubuntu"
SECURITY = "https://security.ubuntu.com/ubuntu"
ARCHIVE_SUITES = {"noble", "noble-updates", "noble-backports"}


def direct_sources(text):
    """Validate all Ubuntu blocks before returning a byte-preserving URI edit."""
    blocks = re.split(r"(\n(?:[ \t]*\n)+)", text)
    found = set()
    for index in range(0, len(blocks), 2):
        lines = blocks[index].splitlines(keepends=True)
        fields = {}
        previous = None
        for line_index, line in enumerate(lines):
            if not line.strip() or line.startswith("#"):
                continue
            if line[0] in " \t" and previous is not None:
                value, first_line = fields[previous]
                fields[previous] = (value + "\n" + line.strip(), first_line)
                continue
            match = re.fullmatch(r"([A-Za-z][A-Za-z0-9-]*):[ \t]*(.*?)(?:\n)?", line)
            if not match:
                raise ValueError("Unsupported Deb822 field layout")
            name, value = match.group(1).lower(), match.group(2)
            if name in fields:
                raise ValueError("Duplicate Deb822 field")
            fields[name] = (value, line_index)
            previous = name
        values = {name: field[0] for name, field in fields.items()}
        uris = values.get("uris", "").split()
        suites = values.get("suites", "").split()
        # Unrelated repositories retain every byte, including their own policy.
        ubuntu = (
            KEYRING in values.get("signed-by", "").split()
            or bool(set(uris) & MIRRORS)
            or any(".ubuntu.com/" in uri for uri in uris)
        )
        if not ubuntu:
            continue
        if (
            set(values) != {"types", "uris", "suites", "components", "signed-by"}
            or values["types"] != "deb"
            or values["signed-by"] != KEYRING
            or "\n" in values["uris"]
            or len(uris) != 1
            or len(suites) != len(set(suites))
            or set(values["components"].split()) != {"main", "restricted", "universe", "multiverse"}
        ):
            raise ValueError("Unexpected Ubuntu source fields or trust configuration")
        if set(suites) == ARCHIVE_SUITES:
            kind, destination = "archive", ARCHIVE
        elif suites == ["noble-security"]:
            kind, destination = "security", SECURITY
        else:
            raise ValueError("Unexpected Ubuntu source suites")
        if kind in found:
            raise ValueError("Duplicate Ubuntu source stanza")
        found.add(kind)
        uri = uris[0]
        allowed_mirrors = MIRRORS if kind == "security" else {"mirror+file:/etc/apt/apt-mirrors.txt"}
        if uri not in allowed_mirrors and uri not in {destination, destination + "/"}:
            raise ValueError("Unexpected Ubuntu source URI")
        if uri in MIRRORS:
            line_index = fields["uris"][1]
            lines[line_index] = lines[line_index].replace(uri, destination, 1)
            blocks[index] = "".join(lines)
    if found != {"archive", "security"}:
        raise ValueError("Expected archive and security Ubuntu source stanzas")
    return "".join(blocks)


def configure(root, os_id, version, architecture):
    """Root is parameterized solely so tests can use a disposable filesystem."""
    if (os_id, version, architecture) != ("ubuntu", "24.04", "amd64"):
        raise ValueError("Only Ubuntu 24.04 amd64 is supported")
    source = Path(root) / "etc/apt/sources.list.d/ubuntu.sources"
    # Do not follow a writable/symlinked parent, source, or hard-linked source.
    for path in [source.parent.parent.parent, source.parent.parent, source.parent, source]:
        info = path.lstat()
        expected_type = stat.S_ISREG if path == source else stat.S_ISDIR
        if not expected_type(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o022:
            raise ValueError("Unsafe Ubuntu source path")
    with os.fdopen(os.open(source, os.O_RDONLY | os.O_NOFOLLOW), "rb") as source_file:
        info = os.fstat(source_file.fileno())
        if info.st_nlink != 1 or info.st_size > 65536:
            raise ValueError("Unsafe Ubuntu source file")
        original = source_file.read().decode("utf-8")
    updated = direct_sources(original)
    if updated == original:
        return False
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=source.parent, delete=False) as output:
            temporary = Path(output.name)
            os.fchmod(output.fileno(), stat.S_IMODE(info.st_mode))
            os.fchown(output.fileno(), info.st_uid, info.st_gid)
            output.write(updated.encode("utf-8"))
            output.flush()
            os.fsync(output.fileno())
        current = source.lstat()
        if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
            raise ValueError("Ubuntu source changed while configuring it")
        os.replace(temporary, source)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return True


if __name__ == "__main__":
    if platform.system() != "Linux" or os.geteuid() != 0:
        raise SystemExit("Ubuntu source configuration requires Linux root")
    release = platform.freedesktop_os_release()
    architecture = subprocess.check_output(["dpkg", "--print-architecture"], text=True).strip()
    changed = configure("/", release.get("ID"), release.get("VERSION_ID"), architecture)
    print("Configured direct signed Ubuntu archives" if changed else "Verified direct signed Ubuntu archives")
