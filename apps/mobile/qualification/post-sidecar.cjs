const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const MAX_SIDECAR_BYTES = 8192;
function sidecarName(name) {
  if (typeof name !== 'string' || !/^pali-native-(?:http|post)-[0-9a-f]{32}\.json$/.test(name)) throw Error('HTTP_SIDECAR_INVALID');
  return name;
}
/** Bound the actual read and reject symlinks/FIFOs before consuming a sidecar. */
function readHttpSidecar(directory, name) {
  let descriptor;
  try {
    descriptor = fs.openSync(path.join(directory, sidecarName(name)), fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_SIDECAR_BYTES) throw Error();
    const bytes = Buffer.alloc(MAX_SIDECAR_BYTES + 1); let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(descriptor, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    if (length > MAX_SIDECAR_BYTES) throw Error();
    return bytes.subarray(0, length).toString('utf8');
  } catch { throw Error('HTTP_SIDECAR_INVALID'); }
  finally { if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch { /* Preserve primary failure. */ } } }
}
/** Device shell is bounded even if an app changes a checked file during the read. */
function readAndroidHttpSidecar(run, name) {
  const file = `/data/user/0/com.paliwallet.qualification/files/${sidecarName(name)}`;
  const command = `[ -f '${file}' ] && [ ! -L '${file}' ] && [ "$(stat -c %s '${file}')" -le ${MAX_SIDECAR_BYTES} ] && head -c ${MAX_SIDECAR_BYTES + 1} '${file}'`;
  const text = run('adb', ['shell', command], false, 5000);
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_SIDECAR_BYTES) throw Error('HTTP_SIDECAR_INVALID');
  return text;
}
module.exports = { readHttpSidecar, readAndroidHttpSidecar };
