const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const { PUBLIC_POOL_FAILURE_FILE, PUBLIC_POOL_FAILURE_BYTES } = require('./public-pool-contract.ts');
const MAX_SIDECAR_BYTES = 8192;
function sidecarName(name) {
  if (name === PUBLIC_POOL_FAILURE_FILE) return name;
  if (typeof name !== 'string' || !/^pali-native-(?:http|post|public-pool)-[0-9a-f]{32}\.json$/.test(name)) throw Error('HTTP_SIDECAR_INVALID');
  return name;
}
const sidecarLimit = (name) => name === PUBLIC_POOL_FAILURE_FILE ? PUBLIC_POOL_FAILURE_BYTES : MAX_SIDECAR_BYTES;
/** Bound the actual read and reject symlinks/FIFOs before consuming a sidecar. */
function readHttpSidecar(directory, name) {
  let descriptor;
  try {
    const limit = sidecarLimit(name);
    descriptor = fs.openSync(path.join(directory, sidecarName(name)), fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 1 || stat.size > limit) throw Error();
    const bytes = Buffer.alloc(limit + 1); let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(descriptor, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > limit) throw Error();
    return bytes.subarray(0, length).toString('utf8');
  } catch { throw Error('HTTP_SIDECAR_INVALID'); }
  finally { if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { /* Preserve primary failure. */ } } }
}
/** Device shell is bounded even if an app changes a checked file during the read. */
function readAndroidHttpSidecar(run, name) {
  const file = `/data/user/0/com.paliwallet.qualification/files/${sidecarName(name)}`;
  const limit = sidecarLimit(name);
  const command = `[ -f '${file}' ] && [ ! -L '${file}' ] && [ "$(stat -c %s '${file}')" -le ${limit} ] && head -c ${limit + 1} '${file}'`;
  const text = run('adb', ['shell', command], false, 5000);
  if (typeof text !== 'string' || Buffer.byteLength(text) > limit) throw Error('HTTP_SIDECAR_INVALID');
  return text;
}
module.exports = { readHttpSidecar, readAndroidHttpSidecar };
