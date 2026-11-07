const { X509Certificate, createHash } = require('node:crypto');
const { readFileSync, statSync } = require('node:fs');

function readPublicPoolCa(file) {
  if (typeof file !== 'string' || !file || !statSync(file).isFile() || statSync(file).size > 8192)
    throw Error('PUBLIC_POOL_QUALIFICATION_CA_REQUIRED');
  const pem = readFileSync(file, 'utf8');
  if (!/^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\r?\n?$/.test(pem))
    throw Error('PUBLIC_POOL_QUALIFICATION_CA_INVALID');
  const cert = new X509Certificate(pem);
  const from = Date.parse(cert.validFrom);
  const to = Date.parse(cert.validTo);
  if (!cert.ca || !(from <= Date.now() && Date.now() < to && to - from <= 7 * 24 * 60 * 60_000))
    throw Error('PUBLIC_POOL_QUALIFICATION_CA_INVALID');
  return { pem, sha256: createHash('sha256').update(cert.raw).digest('hex') };
}
module.exports = { readPublicPoolCa };
