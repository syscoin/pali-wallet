import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';
import { PALI_LANGUAGE_OPTIONS } from '../../../source/shared/languagePolicy.ts';
const swift = readFileSync(new URL('../modules/pali-wallet-storage/ios/PaliCredentialRequest.swift', import.meta.url), 'utf8');
const kotlin = readFileSync(new URL('../modules/pali-wallet-storage/android/src/main/java/org/syscoin/pali/storage/PaliCredentialRequest.kt', import.meta.url), 'utf8');

test('both native platforms package the same fixed nine-language authorization copy', () => {
  const ios = [...swift.matchAll(/case "(\w+)": return PaliCredentialCopy\(unlock: "([^"]+)", authorize: "([^"]+)"\)/g)].map(match => [match[1]!, match[2]!, match[3]!] as const);
  const android = [...kotlin.matchAll(/"(\w+)" -> PaliCredentialCopy\("([^"]+)", "([^"]+)"\)/g)].map(match => [match[1]!, match[2]!, match[3]!] as const);
  assert.deepEqual(android, ios);
  assert.deepEqual(ios.map(item => item[0]).sort(), PALI_LANGUAGE_OPTIONS.map(item => item.value).sort());
  for (const [language, unlock, authorize] of ios) {
    assert(unlock.includes('Pali Wallet')); assert(authorize.includes('Pali Wallet'));
    if (language !== 'en') { assert.notEqual(unlock, 'Unlock Pali Wallet'); assert.notEqual(authorize, 'Authorize access to Pali Wallet'); }
  }
  assert.match(swift, /default: throw PaliCredentialError\.unavailable/);
  assert.match(kotlin, /else -> credentialFailure\(\)/);
});
test('native requests capture copy while existing authenticated policy remains unchanged', () => {
  assert.match(swift, /self\.copy = try credentialCopy\(language\)/);
  assert.match(swift, /localizedReason = binding == nil \? copy\.unlock : copy\.authorize/);
  assert.match(kotlin, /private val copy = credentialCopy\(language\)/);
  assert.match(kotlin, /setTitle\(copy\.unlock\)/); assert.match(kotlin, /setTitle\(copy\.authorize\)/);
  assert.match(swift, /\.deviceOwnerAuthentication/); assert.match(swift, /\.userPresence/);
  assert.match(kotlin, /result\.cryptoObject\?\.cipher !== cipher/);
});
