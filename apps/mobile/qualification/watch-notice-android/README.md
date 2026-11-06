# Standalone Android watch notice probe

This disposable APK compiles `PaliWatchNotice.kt` from the checked-out Pali tree. The build compares the copied source to the Git blob at `HEAD` and records the checkout, blob and source SHA-256. It works on the workflow's shallow merge checkout. The probe has its own package, signing key and notification permission. It uses no wallet manifest, release build, Expo registration, application data or network capability.

The Ubuntu 24.04 qualification job runs this after wallet persistence checks on the dedicated API 35 `PaliQualification` AVD. It uses the already provisioned Java 17, preinstalled Kotlin, and pinned platform and Build Tools 37.0.0. Generated output remains outside the wallet checkout. Supply the serial of that one booted emulator explicitly when running the fixture separately.

```bash
bash "$fixture/build.sh" "$GITHUB_WORKSPACE" "$RUNNER_TEMP/pali-watch-probe-apk"
python3 "$fixture/run-emulator.py" \
  --serial "$emulator_serial" --avd PaliQualification \
  "$RUNNER_TEMP/pali-watch-probe-apk/watch-notice-probe.apk" \
  "$RUNNER_TEMP/pali-native-android/watch-notice-probe"
```

The host selects system permission actions from fresh UI trees. The app asserts a successful quiet channel setup, refusal without permission and after explicit denial, no posting from a permission grant, and real OS delivery only after a separate action. It reads back the exact quiet channel settings, secret visibility, static text and absence of app-supplied actions from Android's active records. Removal is confirmed by the OS while a different tag with the same numeric identifier remains present. Evidence contains the system permission trees, fixture logs and a screenshot of the fixture's observation.

The runner reads the compiled APK manifest through the pinned SDK, requires the sole expected permission and activity, and checks the artifact digest. It refuses physical serials, a nonlocal ADB server override, an unexpected AVD or an existing fixture installation. It installs and removes only the standalone test package. Start with a fresh API 35 AVD to exercise the real Android permission prompts. A successful run would qualify this emulator's permission, accepted delivery and ordinary exact removal. Process interruption before acceptance, lock-screen rendering, native app integration and durable reservation cleanup remain separate.
