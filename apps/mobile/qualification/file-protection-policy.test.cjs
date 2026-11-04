const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('native protection classification accepts complete only, rejecting absent, weaker and unknown classes', {
  skip: process.platform !== 'darwin',
}, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pali-protection-classes-'));
  try {
    const main = path.join(directory, 'main.swift');
    const executable = path.join(directory, 'classification-test');
    writeFileSync(main, `import Foundation
let samples: [(URLFileProtection?, PaliFileProtectionClass)] = [
  (URLFileProtection.complete, .complete),
  (nil, .missing),
  (URLFileProtection.none, .none),
  (URLFileProtection.completeUnlessOpen, .unlessOpen),
  (URLFileProtection.completeUntilFirstUserAuthentication, .untilFirstAuthentication),
  (URLFileProtection(rawValue: "PALI_UNKNOWN_TEST_PROTECTION"), .unknown)
]
for (value, expected) in samples {
  let actual = classifyPaliFileProtection(value)
  precondition(actual == expected)
  precondition(actual.satisfiesWalletPolicy == (expected == .complete))
}
print("6 fixed protection classes checked")
`);
    const compiled = spawnSync('swiftc', ['-module-cache-path', path.join(directory, 'module-cache'),
      require.resolve('../modules/pali-wallet-storage/ios/PaliFileProtectionPolicy.swift'), main, '-o', executable],
    { encoding: 'utf8', timeout: 60000 });
    assert.equal(compiled.status, 0, compiled.stderr);
    const result = spawnSync(executable, [], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), '6 fixed protection classes checked');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
