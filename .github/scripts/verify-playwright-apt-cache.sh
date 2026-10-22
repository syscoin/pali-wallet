#!/usr/bin/env bash
set -euo pipefail

shopt -s nullglob
archives=("${RUNNER_TEMP}/pali-playwright-apt/"*.deb)
if [ "${#archives[@]}" -eq 0 ]; then exit 0; fi
sudo apt-get update -o APT::Update::Error-Mode=any
for archive in "${archives[@]}"; do
  # apt may trust a pre-existing archive's size; require its SHA256
  # from signed repository metadata before allowing cached reuse.
  if [ -f "$archive" ] && [ ! -L "$archive" ] &&
    package="$(dpkg-deb --field "$archive" Package)" &&
    version="$(dpkg-deb --field "$archive" Version)" &&
    architecture="$(dpkg-deb --field "$archive" Architecture)" &&
    [[ "$package" =~ ^[a-z0-9][a-z0-9+.-]*$ ]] &&
    [[ "$version" =~ ^[0-9][A-Za-z0-9.+:~-]*$ ]] &&
    [[ "$architecture" =~ ^[a-z0-9][a-z0-9-]*$ ]] &&
    [ "$(basename "$archive")" = "${package}_${version//:/%3a}_${architecture}.deb" ] &&
    hashes="$(apt-cache show -- "$package=$version" 2>/dev/null | awk '/^SHA256: / { print $2 }')" &&
    [ -n "$hashes" ]; then
    actual="$(sha256sum "$archive" | cut -d ' ' -f 1)"
    if grep -Fxq "$actual" <<< "$hashes"; then
      continue
    fi
  fi
  # Missing, obsolete, or mismatched metadata: discard and redownload.
  rm -f -- "$archive"
done
