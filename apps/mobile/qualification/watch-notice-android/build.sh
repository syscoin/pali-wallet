#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <Pali checkout> <fresh output directory>" >&2
  exit 2
fi
repo=$(cd -- "$1" && pwd)
out=$2
fixture=$(cd -- "$(dirname -- "$0")" && pwd)
transport=apps/mobile/modules/pali-wallet-storage/android/src/main/java/org/syscoin/pali/storage/PaliWatchNotice.kt
sdk=${ANDROID_HOME:?Set ANDROID_HOME to the qualification SDK}
android_jar="$sdk/platforms/android-37.0/android.jar"
tools="$sdk/build-tools/37.0.0"

for command in kotlinc keytool sha256sum zip; do command -v "$command" >/dev/null; done
for command in aapt2 apksigner d8 zipalign; do test -x "$tools/$command"; done
test -s "$android_jar"
head=$(git -C "$repo" rev-parse --verify HEAD)
blob=$(git -C "$repo" rev-parse --verify "HEAD:$transport")
mkdir -- "$out"
out=$(cd -- "$out" && pwd)
stage=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/pali-watch-probe.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT

cp -- "$repo/$transport" "$stage/PaliWatchNotice.kt"
if [[ $(git -C "$repo" hash-object "$stage/PaliWatchNotice.kt") != "$blob" ]]; then
  echo "The transport file differs from the checked-out tree" >&2
  exit 1
fi
{
  printf 'Checkout: %s\nTransport blob: %s\n' "$head" "$blob"
  (cd "$stage" && sha256sum PaliWatchNotice.kt)
} | tee "$out/transport-source.txt"
kotlinc -version
kotlinc -jvm-target 17 -classpath "$android_jar" -include-runtime \
  "$stage/PaliWatchNotice.kt" "$fixture/WatchNoticeProbe.kt" -d "$stage/classes.jar"
mkdir -- "$stage/dex"
"$tools/d8" --release --min-api 35 --lib "$android_jar" \
  --output "$stage/dex" "$stage/classes.jar"
"$tools/aapt2" link -I "$android_jar" --manifest "$fixture/AndroidManifest.xml" -o "$stage/unaligned.apk"
(cd "$stage/dex" && zip -q "$stage/unaligned.apk" classes*.dex)
"$tools/zipalign" -f 4 "$stage/unaligned.apk" "$stage/aligned.apk"

# The signing identity is disposable and scoped to this fixture APK.
keytool -genkeypair -keystore "$stage/probe.p12" -storetype PKCS12 \
  -storepass fixture-only -keypass fixture-only -alias fixture \
  -keyalg RSA -keysize 2048 -validity 2 -dname 'CN=Pali Disposable Android Fixture'
"$tools/apksigner" sign --ks "$stage/probe.p12" --ks-pass pass:fixture-only \
  --key-pass pass:fixture-only --out "$out/watch-notice-probe.apk" "$stage/aligned.apk"
"$tools/apksigner" verify --verbose "$out/watch-notice-probe.apk" > "$out/apk-signature.txt"
"$tools/aapt2" dump badging "$out/watch-notice-probe.apk" > "$out/apk-badging.txt"
grep -q "^package: name='org.syscoin.pali.watchnoticeprobe' " "$out/apk-badging.txt"
grep -Fxq "minSdkVersion:'35'" "$out/apk-badging.txt"
grep -Fxq "targetSdkVersion:'35'" "$out/apk-badging.txt"
grep -Fxq "uses-permission: name='android.permission.POST_NOTIFICATIONS'" "$out/apk-badging.txt"
if grep -Fq "android.permission.INTERNET" "$out/apk-badging.txt"; then
  echo "Unexpected Internet permission in the fixture" >&2
  exit 1
fi
(cd "$out" && sha256sum watch-notice-probe.apk > apk.sha256)
