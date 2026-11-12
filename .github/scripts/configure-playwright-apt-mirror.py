#!/usr/bin/env python3
"""Prefer the hosted runner's cloud mirror; retain the fixed outage fallback.

https://status.canonical.com/rss
https://github.com/actions/runner-images/issues/15296
https://mirrors.kernel.org/ lists its Ubuntu archive. APT still authenticates
its Release files with the runner's existing Ubuntu keys and source settings.
"""
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import tempfile


ORIGINAL = (
    b"http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n"
    b"https://archive.ubuntu.com/ubuntu/\tpriority:2\n"
    b"https://security.ubuntu.com/ubuntu/\tpriority:3\n"
)
KERNEL_FIRST = (
    b"https://mirrors.kernel.org/ubuntu/\tpriority:1\n"
    + ORIGINAL.replace(b"priority:3", b"priority:4")
    .replace(b"priority:2", b"priority:3").replace(b"priority:1", b"priority:2")
)
PREFERRED = (
    b"http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\n"
    b"https://mirrors.kernel.org/ubuntu/\tpriority:2\n"
    b"https://archive.ubuntu.com/ubuntu/\tpriority:3\n"
    b"https://security.ubuntu.com/ubuntu/\tpriority:4\n"
)


# Canonical cloud-init uses <region>.ec2.archive.ubuntu.com for EC2 instances:
# https://github.com/canonical/cloud-init/blob/main/doc/examples/cloud-config-apt.txt
# Match only the complete first entry; the remaining entries are exact below.
REGIONAL_FIRST = re.compile(
    rb"http://[a-z]{2}-(?:gov-)?(?:central|east|north|northeast|northwest|south|southeast|southwest|west)-[1-9]"
    rb"\.ec2\.archive\.ubuntu\.com/ubuntu/\tpriority:1\n"
)


def configure(root, architecture):
    if architecture != "amd64":
        raise ValueError("The Ubuntu archive mirror requires amd64")
    root = Path(root)
    target = root / "etc/apt/apt-mirrors.txt"
    for path in [root, root / "etc", target.parent, target]:
        info = path.lstat()
        normal = stat.S_ISREG if path == target else stat.S_ISDIR
        if not normal(info.st_mode) or info.st_uid != os.geteuid() or info.st_gid != os.getegid() or info.st_mode & 0o022:
            raise ValueError("Unsafe apt mirror-list path")
    with os.fdopen(os.open(target, os.O_RDONLY | os.O_NOFOLLOW), "rb") as source:
        info = os.fstat(source.fileno())
        contents = source.read(4096)
        if info.st_nlink != 1:
            raise ValueError(f"Unsafe apt mirror-list link count: {info.st_nlink}")
        preferred = PREFERRED
        accepted = (ORIGINAL, KERNEL_FIRST, PREFERRED)
        regional = REGIONAL_FIRST.match(contents)
        if regional:
            first = regional.group()
            regional_original = first + ORIGINAL.split(b"\n", 1)[1]
            preferred = first + PREFERRED.split(b"\n", 1)[1]
            accepted = (regional_original, preferred)
        if contents not in accepted:
            # This is public runner configuration, but emit only bounded hex:
            # unexpected bytes must never become terminal or workflow commands.
            prefix = contents[:512]
            raise ValueError(
                "Unexpected hosted-runner apt mirror list: "
                f"size={info.st_size} read={len(contents)} "
                f"prefix_bytes={len(prefix)} prefix_hex={prefix.hex()}"
            )
        if contents == preferred:
            return False
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as output:
            temporary = Path(output.name)
            os.fchmod(output.fileno(), stat.S_IMODE(info.st_mode))
            os.fchown(output.fileno(), info.st_uid, info.st_gid)
            output.write(preferred)
            output.flush()
            os.fsync(output.fileno())
        current = target.lstat()
        if (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
            raise ValueError("Apt mirror list changed during configuration")
        os.replace(temporary, target)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return True


if __name__ == "__main__":
    if platform.system() != "Linux" or os.geteuid() != 0 or platform.freedesktop_os_release().get("ID") != "ubuntu":
        raise SystemExit("Mirror configuration requires Ubuntu root")
    architecture = subprocess.check_output(["dpkg", "--print-architecture"], text=True).strip()
    if architecture != "amd64":
        raise SystemExit("The Ubuntu archive mirror requires amd64")
    print("Configured preferred Ubuntu archive mirror" if configure("/", architecture) else "Verified preferred Ubuntu archive mirror")
