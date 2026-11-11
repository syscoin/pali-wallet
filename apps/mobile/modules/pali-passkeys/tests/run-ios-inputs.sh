#!/bin/sh
set -eu

test_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
module_dir=$(dirname -- "$test_dir")
scratch=$(mktemp -d "${TMPDIR:-/tmp}/pali-passkeys.XXXXXXXX")
trap 'rm -rf "$scratch"' EXIT HUP INT TERM

xcrun swiftc -swift-version 5 -module-cache-path "$scratch/module-cache" \
  "$module_dir/ios/PaliPasskeyRequest.swift" "$test_dir/main.swift" \
  -o "$scratch/checks"
"$scratch/checks"
