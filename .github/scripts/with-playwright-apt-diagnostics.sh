#!/usr/bin/env bash
set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo 'An apt verification or Playwright installation command is required' >&2
  exit 64
fi
if "$@"; then
  exit 0
else
  command_status=$?
fi

# Read-only evidence after failure. Never change DNS, apt trust or its sandbox,
# and never replace the original failure with a diagnostic command's status.
printf 'Apt/Playwright command failed with exit code %s; collecting DNS evidence\n' "$command_status"
timeout 8s sudo -n namei -l /etc/resolv.conf
for principal in root _apt; do
  if timeout 8s sudo -n -u "$principal" test -r /etc/resolv.conf; then
    printf '%s can read /etc/resolv.conf\n' "$principal"
  else
    printf '%s resolver readability probe exit code: %s\n' "$principal" "$?"
  fi
  for host in archive.ubuntu.com security.ubuntu.com packages.microsoft.com; do
    printf 'DNS lookup as %s: %s\n' "$principal" "$host"
    if timeout 8s sudo -n -u "$principal" getent ahosts "$host"; then
      printf 'DNS lookup succeeded\n'
    else
      printf 'DNS lookup exit code: %s\n' "$?"
    fi
  done
done
exit "$command_status"
