#!/usr/bin/env python3
"""Drive only a named disposable API 35 emulator and the standalone fixture APK."""
import argparse
import hashlib
import os
from pathlib import Path
import re
import subprocess
import time
from uuid import uuid4
import xml.etree.ElementTree as ET

PACKAGE = "org.syscoin.pali.watchnoticeprobe"
ACTIVITY = "org.syscoin.pali.storage.WatchNoticeProbe"
CONTROLLERS = {"com.android.permissioncontroller", "com.google.android.permissioncontroller"}
ANDROID = "{http://schemas.android.com/apk/res/android}"
ADB_SERVER_ENV = {"ADB_SERVER_SOCKET", "ADB_SERVER_PORT", "ANDROID_ADB_SERVER_ADDRESS", "ANDROID_ADB_SERVER_PORT"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--avd", required=True)
    parser.add_argument("apk", type=Path)
    parser.add_argument("evidence", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"emulator-[0-9]{4,5}", args.serial):
        parser.error("a local emulator serial is required")
    apk = args.apk.resolve(strict=True)
    if apk.name != "watch-notice-probe.apk":
        parser.error("use the APK emitted by build.sh")
    sdk = os.environ.get("ANDROID_HOME")
    if not sdk:
        parser.error("set ANDROID_HOME to the qualification SDK")
    if ADB_SERVER_ENV.intersection(os.environ):
        parser.error("ADB server overrides are incompatible with this local emulator fixture")
    adb_tool = Path(sdk) / "platform-tools" / "adb"
    apkanalyzer = Path(sdk) / "cmdline-tools" / "pali-15859902" / "bin" / "apkanalyzer"
    data = subprocess.run([str(apkanalyzer), "manifest", "print", str(apk)], capture_output=True,
                          timeout=15, check=True).stdout
    manifest = ET.fromstring(data)
    uses_sdk = manifest.find("uses-sdk")
    app = manifest.find("application")
    activity = app.find("activity") if app is not None else None
    digest = (apk.parent / "apk.sha256").read_text().split()[0]
    if (manifest.tag != "manifest" or manifest.get("package") != PACKAGE or
            sorted(node.tag for node in manifest) != ["application", "uses-permission", "uses-sdk"] or
            manifest.find("uses-permission").get(ANDROID + "name") != "android.permission.POST_NOTIFICATIONS" or
            uses_sdk.get(ANDROID + "minSdkVersion") != "35" or uses_sdk.get(ANDROID + "targetSdkVersion") != "35" or
            app.get(ANDROID + "allowBackup") != "false" or len(app) != 1 or activity is None or len(activity) or
            activity.get(ANDROID + "name") != ACTIVITY or activity.get(ANDROID + "exported") != "true" or
            hashlib.sha256(apk.read_bytes()).hexdigest() != digest):
        parser.error("the package or hash differs from the built fixture")
    args.evidence.mkdir()

    def adb(*command, timeout=8, check=True):
        result = subprocess.run([str(adb_tool), "-H", "127.0.0.1", "-P", "5037", "-s", args.serial, *command],
                                capture_output=True, timeout=timeout, check=check)
        return result.stdout

    def value(*command):
        return adb(*command).decode().strip()

    avd = value("emu", "avd", "name").splitlines()
    if (not avd or avd[0] != args.avd or not any(value("shell", "getprop", prop) == "1"
            for prop in ("ro.boot.qemu", "ro.kernel.qemu")) or value("shell", "getprop", "ro.build.version.sdk") != "35" or
            value("shell", "getprop", "sys.boot_completed") != "1"):
        raise RuntimeError("expected the named booted API 35 emulator")
    if adb("shell", "pm", "path", PACKAGE, check=False).strip():
        raise RuntimeError("fixture package is already installed")

    def dump_ui():
        path = f"/data/local/tmp/pali-watch-notice-{uuid4().hex}.xml"
        try:
            adb("shell", "uiautomator", "dump", path)
            return adb("exec-out", "cat", path)
        finally:
            adb("shell", "rm", "-f", path, check=False)

    def wait_for(label, match, artifact):
        deadline = time.monotonic() + 22
        while time.monotonic() < deadline:
            try:
                data = dump_ui()
                tree = ET.fromstring(data)
            except (ET.ParseError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
                time.sleep(0.25)
                continue
            nodes = list(tree.iter("node"))
            failed = next((node.get("text") for node in nodes if node.get("package") == PACKAGE and
                           node.get("text", "").startswith("FAIL:")), None)
            if failed:
                (args.evidence / "failed-window.xml").write_bytes(data)
                raise RuntimeError(failed)
            matches = [node for node in nodes if match(node)]
            if len(matches) == 1:
                (args.evidence / f"{artifact}.xml").write_bytes(data)
                return matches[0]
            time.sleep(0.25)
        raise RuntimeError(f"unique current UI node not found: {label}")

    def fixture_node(text):
        return lambda node: node.get("package") == PACKAGE and node.get("text") == text

    def tap(label, match, artifact):
        node = wait_for(label, match, artifact)
        bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
        if bounds is None:
            raise RuntimeError(f"missing UI-tree bounds for {label}")
        x0, y0, x1, y1 = map(int, bounds.groups())
        if x0 >= x1 or y0 >= y1 or node.get("enabled") != "true" or node.get("clickable") != "true":
            raise RuntimeError(f"non-actionable UI node for {label}")
        adb("shell", "input", "tap", str((x0 + x1) // 2), str((y0 + y1) // 2))

    def tap_fixture(text, artifact):
        tap(text, fixture_node(text), artifact)

    def permission_button(name, artifact):
        tap(name, lambda node: node.get("package") in CONTROLLERS and
            node.get("resource-id") in {f"{controller}:id/permission_{name}_button" for controller in CONTROLLERS}, artifact)

    def expect(text, artifact):
        wait_for(text, fixture_node(text), artifact)
        print(text, flush=True)

    installed = False
    try:
        adb("install", str(apk), timeout=30)
        installed = True
        adb("shell", "input", "keyevent", "KEYCODE_WAKEUP")
        adb("shell", "wm", "dismiss-keyguard")
        adb("shell", "am", "start", "-W", "-n", f"{PACKAGE}/{ACTIVITY}", timeout=20)
        expect("Fixture ready", "01-ready")
        tap_fixture("Check initial refusal", "02-check-refusal")
        expect("Posting refused without permission", "03-refused")
        tap_fixture("Request notification permission", "04-request-denial")
        permission_button("deny", "05-deny-dialog")
        expect("Permission denied; posting refused", "06-denied")
        tap_fixture("Request notification permission", "07-request-grant")
        permission_button("allow", "08-allow-dialog")
        expect("Permission granted; nothing posted", "09-granted")
        tap_fixture("Post generic notice", "10-post")
        expect("Delivered generic secret notice and unrelated control", "11-delivered")
        (args.evidence / "11-delivered.png").write_bytes(adb("exec-out", "screencap", "-p"))
        tap_fixture("Remove exact notice", "12-remove")
        expect("Removed exact notice; unrelated control preserved", "13-removed")
    finally:
        if installed:
            try:
                log = adb("logcat", "-d", "-s", "PaliWatchNoticeProbe:I", check=False)
                (args.evidence / "fixture.log").write_bytes(log)
            finally:
                adb("uninstall", PACKAGE, timeout=20)


if __name__ == "__main__":
    main()
