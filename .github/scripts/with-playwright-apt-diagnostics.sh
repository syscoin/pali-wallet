#!/usr/bin/env bash
set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo 'An apt verification or Playwright installation command is required' >&2
  exit 64
fi
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
elevation_dir=
cleanup() { if [ -n "$elevation_dir" ]; then rm -rf -- "$elevation_dir"; fi; }
trap cleanup EXIT
if { [ "$#" -eq 5 ] && [ "$1" = npx ] && [ "$2" = playwright ] && [ "$3" = install ] && [ "$4" = --with-deps ] && [ "$5" = chromium ]; } ||
   { [ "$#" -eq 6 ] && [ "$1" = npx ] && [ "$2" = --no-install ] && [ "$3" = playwright ] && [ "$4" = install ] && [ "$5" = --with-deps ] && [ "$6" = chromium ]; }; then
  if [ "$(id -u)" -eq 0 ]; then
    echo 'Playwright browser installation must run as the unprivileged runner' >&2
    exit 64
  fi
  if [ ! -x "$script_dir/playwright-apt-sudo.sh" ]; then
    echo 'Playwright elevation shim is unavailable' >&2
    exit 64
  fi
  elevation_dir="$(mktemp -d "${TMPDIR:-/tmp}/pali-playwright-elevation.XXXXXX")" || exit "$?"
  chmod 0700 "$elevation_dir" || exit "$?"
  ln -s "$script_dir/playwright-apt-sudo.sh" "$elevation_dir/sudo" || exit "$?"
  set -- env "PATH=$elevation_dir:$PATH" "$@"
fi
# This bounds unprivileged work. The scoped elevation shim and cache verifier
# each install a root-owned deadline for their privileged APT descendants.
if timeout --signal=TERM --kill-after=15s 600s "$@"; then
  exit 0
else
  command_status=$?
fi

# Read-only evidence after failure. Never change DNS, apt trust or its sandbox,
# and never replace the original failure with a diagnostic command's status.
printf 'Apt/Playwright command failed with exit code %s; collecting DNS evidence\n' "$command_status"
timeout --kill-after=2s 8s sudo -n namei -l /etc/resolv.conf
for principal in root _apt; do
  if timeout --kill-after=2s 8s sudo -n -u "$principal" test -r /etc/resolv.conf; then
    printf '%s can read /etc/resolv.conf\n' "$principal"
  else
    printf '%s resolver readability probe exit code: %s\n' "$principal" "$?"
  fi
  for host in azure.archive.ubuntu.com mirrors.kernel.org mirrors.edge.kernel.org archive.ubuntu.com security.ubuntu.com packages.microsoft.com; do
    printf 'DNS lookup as %s: %s\n' "$principal" "$host"
    if timeout --kill-after=2s 8s sudo -n -u "$principal" getent ahosts "$host"; then
      printf 'DNS lookup succeeded\n'
    else
      printf 'DNS lookup exit code: %s\n' "$?"
    fi
  done
done
exit "$command_status"
