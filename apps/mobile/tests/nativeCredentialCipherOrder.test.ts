import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

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

const moduleSource = readFileSync(new URL('../modules/pali-wallet-storage/android/src/main/java/org/syscoin/pali/storage/PaliWalletStorageModule.kt', import.meta.url), 'utf8');

function assertFactoryOnlyCredentialRegistration(candidate: string) {
  const start = candidate.indexOf('Class("CredentialRequest", PaliCredentialRequest::class)');
  const end = candidate.indexOf('AsyncFunction("prepareNotificationStorage")', start);
  assert(start >= 0 && end > start);
  // Expo requires a constructor even when handles are returned by native factories.
  // It must refuse JS allocation before an unowned request can be created.
  const registration = candidate.slice(start, end);
  assert.match(registration, /Constructor\s*\{\s*throw PaliCredentialFailure\("CREDENTIAL_UNAVAILABLE"\)\s*\}/);
  assert.equal((registration.match(/Constructor\s*\{/g) ?? []).length, 1);
}

test('the native credential class declares a refusing constructor for factory-only handles', () => {
  assertFactoryOnlyCredentialRegistration(moduleSource);
});

test('missing credential class constructor is rejected before another startup regression', () => {
  const regressed = moduleSource.replace('      Constructor { throw PaliCredentialFailure("CREDENTIAL_UNAVAILABLE") }\n', '');
  assert.notEqual(regressed, moduleSource);
  assert.throws(() => assertFactoryOnlyCredentialRegistration(regressed));
});

test('public-view mode has no CryptoObject, Keystore or credential-file operation', () => {
  const view = source.slice(source.indexOf('  private fun authorizeView('), source.indexOf('  internal fun run('));
  assert.match(view, /prompt\.authenticate\(cancellation, credentialExecutor/);
  assert.match(view, /whenForeground\(promise, false, null\)/);
  assert.match(view, /check\(\); finish\(promise, null, null, false, null\)/);
  assert.doesNotMatch(view, /owner\.store|KeyStore|Cipher\.|CryptoObject\(|doFinal|updateAAD/);
  assert.match(moduleSource, /Function\("prepareViewAuthorization"\) \{ PaliCredentialRequest\(credentials\(\)\) \}/);
});
