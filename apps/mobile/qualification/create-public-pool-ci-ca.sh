#!/usr/bin/env bash
set -euo pipefail
umask 077

[[ "${CI:-}" == true && "${GITHUB_ACTIONS:-}" == true &&
   "${PALI_NATIVE_QUALIFICATION:-}" == 1 && "${PALI_NATIVE_PUBLIC_POOL_QUALIFICATION:-}" == 1 &&
   "${PALI_NATIVE_HTTP_QUALIFICATION:-}" == 0 &&
   -d "${RUNNER_TEMP:-}" && -f "${GITHUB_ENV:-}" ]]
# Only a newly created runner-owned directory ever contains these keys.
tls=$(mktemp -d "$RUNNER_TEMP/pali-public-pool-tls.XXXXXXXX")
trap 'rm -f -- "$tls/ca.key" "$tls/server.csr" "$tls/ca.srl" "$tls/ca.cnf" "$tls/server.ext"' EXIT
cat > "$tls/ca.cnf" <<'CONFIG'
[req]
prompt=no
distinguished_name=dn
x509_extensions=ca
[dn]
CN=Pali public pool qualification CA
[ca]
basicConstraints=critical,CA:true,pathlen:0
keyUsage=critical,keyCertSign,cRLSign
subjectKeyIdentifier=hash
CONFIG
cat > "$tls/server.ext" <<'CONFIG'
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=IP:127.0.0.1
authorityKeyIdentifier=keyid,issuer
CONFIG
openssl req -new -x509 -newkey rsa:2048 -nodes -sha256 -days 1 \
  -config "$tls/ca.cnf" -keyout "$tls/ca.key" -out "$tls/ca.pem" >/dev/null 2>&1
openssl req -new -newkey rsa:2048 -nodes -sha256 -subj '/CN=127.0.0.1' \
  -keyout "$tls/server.key" -out "$tls/server.csr" >/dev/null 2>&1
openssl x509 -req -in "$tls/server.csr" -CA "$tls/ca.pem" -CAkey "$tls/ca.key" -CAcreateserial \
  -days 1 -sha256 -extfile "$tls/server.ext" -out "$tls/server.pem" >/dev/null 2>&1
openssl verify -CAfile "$tls/ca.pem" -purpose sslserver "$tls/server.pem"
{
  printf 'PALI_PUBLIC_POOL_FIXTURE_CA=%s\n' "$tls/ca.pem"
  printf 'PALI_PUBLIC_POOL_FIXTURE_CERT=%s\n' "$tls/server.pem"
  printf 'PALI_PUBLIC_POOL_FIXTURE_KEY=%s\n' "$tls/server.key"
} >> "$GITHUB_ENV"
