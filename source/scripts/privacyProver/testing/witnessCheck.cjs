// Public synthetic fixture only; no network, keys, wallet state, or remote code.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const assert = require('assert/strict');
const create = require('../witnessFactory.js');
const fixture = require('../../../utils/privacy/prover.fixture.json');
const metadata = JSON.parse(
  zlib.gunzipSync(
    fs.readFileSync(path.join(__dirname, '../assets/metadata.json.gz'))
  )
);
const input = {
  ...fixture.input,
  pathElements: fixture.input.pathElements.map((value) =>
    BigInt(value).toString()
  ),
  pathIndices: [...fixture.input.pathIndices],
};
for (const name of ['root', 'nullifierHash', 'recipient', 'relayer'])
  input[name] = BigInt(input[name]).toString();
const witness = create(metadata).calculateWitness(input);
const sha256 = crypto
  .createHash('sha256')
  .update(witness.map(String).join('\n'))
  .digest('hex');
assert.equal(witness.length, 28300);
assert.equal(sha256, fixture.witnessSha256);
for (const field of ['pathIndices', 'pathElements']) {
  const bad = { ...input, [field]: [...input[field]] };
  bad[field][0] =
    field === 'pathIndices'
      ? 1
      : (BigInt(bad[field][0]) + BigInt(1)).toString();
  assert.throws(() => create(metadata).calculateWitness(bad));
}
console.log(
  JSON.stringify({ values: witness.length, sha256, invalidPathsRejected: 2 })
);
