#!/usr/bin/env bash
set -euo pipefail

# Ubuntu's AppArmor policy denies unprivileged user namespaces to the downloaded
# Playwright Chromium. Use the runner image's installed Chrome setuid helper,
# as documented by Chromium, without disabling AppArmor or Chromium sandboxing.
# https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md
helper=/opt/google/chrome/chrome-sandbox
[[ "$(uname -s)" == Linux ]]
[[ -n "${GITHUB_ENV:-}" ]]
[[ -f "$helper" && ! -L "$helper" && -x "$helper" ]]
[[ "$(stat -c '%u:%g:%a' "$helper")" == '0:0:4755' ]]
[[ "$(dpkg-query -S "$helper")" == "google-chrome-stable: $helper" ]]

# Every path component must be root-owned and non-writable to ordinary users;
# never elevate or install a helper copied from the PR or browser download cache.
for parent in / /opt /opt/google /opt/google/chrome; do
  [[ ! -L "$parent" && "$(stat -c '%u:%g' "$parent")" == '0:0' ]]
  mode=$(stat -c '%a' "$parent")
  (( (8#$mode & 8#022) == 0 ))
done

# Verify the installed helper against its package manifest before using it.
expected=$(awk '$2 == "opt/google/chrome/chrome-sandbox" { print $1 }' \
  /var/lib/dpkg/info/google-chrome-stable.md5sums)
[[ "$expected" =~ ^[0-9a-f]{32}$ ]]
[[ "$(md5sum "$helper" | cut -d ' ' -f 1)" == "$expected" ]]
sha256sum "$helper"
printf 'CHROME_DEVEL_SANDBOX=%s\n' "$helper" >> "$GITHUB_ENV"
