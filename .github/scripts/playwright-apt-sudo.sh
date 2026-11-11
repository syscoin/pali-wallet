#!/usr/bin/env bash
set -euo pipefail

# Only Playwright's pinned dependency-install command may cross this boundary.
# Package names are forwarded as positional arguments, never as shell source.
if [ "$(id -u)" -eq 0 ] || [ "$#" -ne 4 ] || [ "$1" != -- ] || [ "$2" != sh ] || [ "$3" != -c ]; then
  echo 'Unexpected Playwright elevation request' >&2
  exit 64
fi
prefix='apt-get update&& apt-get install -y --no-install-recommends '
if [ "${#4}" -gt 8192 ] || [[ "$4" != "$prefix"* ]]; then
  echo 'Unexpected Playwright dependency command' >&2
  exit 64
fi
package_text="${4#"$prefix"}"
read -r -a packages <<< "$package_text"
if [ "${#packages[@]}" -eq 0 ] || [ "${#packages[@]}" -gt 128 ] || [ "$package_text" != "${packages[*]}" ]; then
  echo 'Unexpected Playwright package list' >&2
  exit 64
fi
for package in "${packages[@]}"; do
  if [[ ! "$package" =~ ^[a-z0-9][a-z0-9+.-]*$ ]]; then
    echo 'Unexpected Playwright package name' >&2
    exit 64
  fi
done

# The timer and its APT descendants have the same root authority, including
# the final KILL deadline. The caller and browser downloads remain unprivileged.
exec /usr/bin/sudo -n /usr/bin/timeout --signal=TERM --kill-after=15s 480s /bin/sh -c '
  /usr/bin/apt-get -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 -o Acquire::Retries=1 -o APT::Update::Error-Mode=any update &&
  /usr/bin/apt-get -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 -o Acquire::Retries=1 install -y --no-install-recommends "$@"
' pali-playwright-apt "${packages[@]}"
