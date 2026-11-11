import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../modules/pali-wallet-storage/android/src/main/java/org/syscoin/pali/storage/PaliCredentialRequest.kt', import.meta.url), 'utf8');
/** Static platform-contract gate; real KeyMint acceptance still needs a physical device. */
function assertAuthenticatedAadOrder(candidate: string) {
  const begin = candidate.indexOf('internal fun run(promise: Promise)');
  const prompt = candidate.indexOf('prompt.authenticate(', begin);
  const success = candidate.indexOf('override fun onAuthenticationSucceeded(', prompt);
  const foreground = candidate.indexOf('whenForeground(', success);
  const associatedData = [...candidate.matchAll(/cipher\.updateAAD\(/g)].map(match => match.index!);
  const finals = [...candidate.matchAll(/cipher\.doFinal\(/g)].map(match => match.index!);
  assert(begin >= 0 && prompt > begin && success > prompt && foreground > success);
  assert.equal(associatedData.length, 1, 'Every mode shares one authenticated AAD boundary');
  assert(associatedData[0]! > foreground, 'AAD must wait for OS success and foreground return');
  assert(/try\s*\{\s*check\(\)/.test(candidate.slice(foreground, associatedData[0])), 'Owner check must precede AAD');
  assert.equal(finals.length, 3, 'Stage, secret read, and authorization-only modes remain covered');
  assert(finals.every(position => position > associatedData[0]!), 'AAD must precede every final operation');
}

test('Android per-use keys perform AAD only in the authenticated foreground callback', () => {
  assertAuthenticatedAadOrder(source);
});

test('the pre-prompt AAD regression is rejected by the platform-contract gate', () => {
  const aad = source.match(/^[\t ]*cipher\.updateAAD\([^\n]+\)\n/m)?.[0];
  assert(aad);
  const regressed = source.replace(aad, '').replace('        val ownedAlias = created', `${aad}        val ownedAlias = created`);
  assert.throws(() => assertAuthenticatedAadOrder(regressed), /AAD must wait/);
});
