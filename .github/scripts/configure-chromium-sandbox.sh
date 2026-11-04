#!/usr/bin/env bash
set -euo pipefail

# Ubuntu's AppArmor policy denies unprivileged user namespaces to downloaded
# Chromium. The runner image also makes /opt writable, so do not execute its
# installed helper with elevated permissions in place. Read it as the ordinary
# user into a protected private file and verify against trusted package metadata
# before enabling the sandbox helper. Never elevate a PR/browser-cache binary.
# https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md
source_helper=/opt/google/chrome/chrome-sandbox
directory=/usr/local/lib/pali-chromium-sandbox
helper=$directory/chrome-sandbox
manifest=/var/lib/dpkg/info/google-chrome-stable.md5sums
created=0
ready=0

fail() {
  printf 'Chromium sandbox setup: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  # Never remove pre-existing state or recursively remove a directory. Only this
  # invocation's fresh protected directory can have been marked as created.
  if [[ "$created" == 1 && "$ready" == 0 ]]; then
    sudo -n rm -f -- "$helper" || printf 'Chromium sandbox cleanup: could not remove helper\n' >&2
    sudo -n rmdir -- "$directory" || printf 'Chromium sandbox cleanup: could not remove directory\n' >&2
  fi
}
trap cleanup EXIT

protected_path() {
  local path=$1 type=$2 description owner group mode actual_type
  description=$(LC_ALL=C stat -c '%u:%g:%a:%F' -- "$path") || fail "cannot inspect $path"
  IFS=: read -r owner group mode actual_type <<< "$description"
  # GNU stat distinguishes empty regular files; both labels mean S_ISREG.
  [[ "$actual_type" == "$type" || ( "$type" == 'regular file' && "$actual_type" == 'regular empty file' ) ]] || fail "$path must be a $type, not a symlink or other file type"
  [[ "$owner:$group" == '0:0' ]] || fail "$path must be owned by root:root"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail "invalid permissions for $path"
  (( (8#$mode & 8#022) == 0 )) || fail "$path must not be writable by group or others"
}

[[ "$(uname -s)" == Linux ]] || fail 'Linux is required'
[[ -n "${GITHUB_ENV:-}" ]] || fail 'GITHUB_ENV is required'
runner_uid=$(id -u) || fail 'cannot read caller identity'
[[ "$runner_uid" =~ ^[0-9]+$ && "$runner_uid" != 0 ]] || fail 'run setup as the ordinary job user, not root'

# These ancestors and metadata files are the trust boundary. The source under
# writable /opt is deliberately NOT trusted until the protected copy is hashed.
for parent in / /usr /usr/local /usr/local/lib /var /var/lib /var/lib/dpkg /var/lib/dpkg/info; do
  protected_path "$parent" directory
done
for file in "$manifest" /var/lib/dpkg/info/google-chrome-stable.list /var/lib/dpkg/status; do
  protected_path "$file" 'regular file'
done
[[ "$(dpkg-query -W -f='${Status}' google-chrome-stable)" == 'install ok installed' ]] || fail 'google-chrome-stable is not installed'
[[ "$(dpkg-query -S "$source_helper")" == "google-chrome-stable: $source_helper" ]] || fail 'installed helper does not belong to google-chrome-stable'
expected=$(awk '$2 == "opt/google/chrome/chrome-sandbox" { print $1 }' "$manifest") || fail 'cannot read package manifest'
[[ "$expected" =~ ^[0-9a-f]{32}$ ]] || fail 'package manifest must contain exactly one helper digest'

# mkdir without -p refuses any pre-existing destination. In particular, do not
# repair/chmod a directory or symlink installed by another invocation or job.
sudo -n mkdir -m 755 -- "$directory" || fail 'cannot create a fresh protected helper directory'
created=1
protected_path "$directory" directory
sudo -n install -o 0 -g 0 -m 600 -- /dev/null "$helper" || fail 'cannot create a private helper target'
protected_path "$helper" 'regular file'
[[ "$(LC_ALL=C stat -c '%a' -- "$helper")" == 600 ]] || fail 'helper target must initially have mode 600'
# Never let root resolve the writable source path: a substituted symlink must
# have only the ordinary user's read authority. tee receives bytes, not a source
# path; its fixed target stays private and non-executable until verified.
cat -- "$source_helper" | sudo -n tee -- "$helper" >/dev/null || fail 'cannot read installed helper as the ordinary user'
protected_path "$helper" 'regular file'
[[ "$(LC_ALL=C stat -c '%a' -- "$helper")" == 600 ]] || fail 'copied helper must remain private before verification'
[[ "$(sudo -n md5sum -- "$helper" | cut -d ' ' -f 1)" == "$expected" ]] || fail 'copied helper does not match the installed package manifest'

sudo -n chmod 4755 -- "$helper" || fail 'cannot enable the verified sandbox helper'
protected_path "$helper" 'regular file'
[[ "$(LC_ALL=C stat -c '%a' -- "$helper")" == 4755 ]] || fail 'verified helper must have mode 4755'
[[ "$(md5sum "$helper" | cut -d ' ' -f 1)" == "$expected" ]] || fail 'helper changed after verification'
sha256sum "$helper" || fail 'cannot record helper SHA256'
printf 'CHROME_DEVEL_SANDBOX=%s\n' "$helper" >> "$GITHUB_ENV" || fail 'cannot export the verified sandbox helper'
ready=1
