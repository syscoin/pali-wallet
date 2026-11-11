import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const source = readFileSync(new URL('../modules/pali-wallet-storage/ios/PaliCredentialRequest.swift', import.meta.url), 'utf8');

/** Source contract only: actual Keychain/LocalAuthentication behavior needs device qualification. */
function assertKnownPolicyBeforeKeychainRead(candidate: string) {
  const start = candidate.indexOf('  func run(_ promise: Promise)');
  const run = candidate.slice(start, candidate.indexOf('  override func sharedObjectDidRelease()', start));
  assert(start >= 0);
  assert.match(run, /SecAccessControlCreateWithFlags\(nil, kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly, \.userPresence, &error\)/);
  assert(run.indexOf('SecAccessControlCreateWithFlags(') < run.indexOf('if let staged {'));
  assert.doesNotMatch(run, /SecItemCopyMatching/,
    'Protected metadata must not be queried before the fresh OS authorization');
  assert.match(run, /accessControl = access; nativeWork = false/,
    'The expected ACL must stay retained through asynchronous authentication');
  assert.match(run, /authentication\.evaluateAccessControl\(access, operation: \.useItem/);
  assert.match(run, /if succeeded \{ awaitForeground\(authentication\) \}/);
}

function assertAuthenticatedMetadataBeforeSecret(candidate: string) {
  const start = candidate.indexOf('  private func startRead(_ authentication: LAContext)');
  const read = candidate.slice(start, candidate.indexOf('  private func awaitForeground(', start));
  assert(start >= 0);
  assert.match(read, /authentication\.interactionNotAllowed = true/);
  assert.match(read, /query\[kSecUseAuthenticationContext as String\] = authentication/);
  assert.match(read, /query\[kSecReturnAttributes as String\] = true/);
  const metadata = read.indexOf('let metadataStatus = SecItemCopyMatching(');
  const noSecretBoundary = read.indexOf('if !authorizationOnly {');
  const data = read.indexOf('query[kSecReturnData as String] = true');
  assert(metadata >= 0 && noSecretBoundary > metadata && data > noSecretBoundary);
  const validation = read.slice(metadata, noSecretBoundary);
  for (const expected of [
    'metadataStatus == errSecSuccess', 'attributes.count <= 32',
    'attributes[kSecAttrService as String] as? String == credentialService',
    'attributes[kSecAttrAccount as String] as? String == binding.account',
    'attributes[kSecAttrAccessible as String] as? String == kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly as String',
    'CFGetTypeID(access as CFTypeRef) == SecAccessControlGetTypeID()',
    'result = nil; try check()',
  ]) assert(validation.includes(expected), `Missing authenticated metadata guard: ${expected}`);
  assert.doesNotMatch(read, /CFEqual\(/,
    'Opaque ACL private binding state must not be compared against a fresh object');
  assert.match(read.slice(data), /let status = SecItemCopyMatching\(query as CFDictionary, &result\)/);
  assert.match(read.slice(data), /try check\(\)/);
  assert.match(read.slice(data), /validCredentialSecret\(plaintext!\)/);
  assert.match(read, /plaintext!\.resetBytes/);
}

test('iOS authorizes the fixed native policy before touching protected metadata', () => {
  assertKnownPolicyBeforeKeychainRead(source);
});

test('a preauthorization metadata read is rejected by the iOS contract', () => {
  const regressed = source.replace('        var error: Unmanaged<CFError>?', '        SecItemCopyMatching([:] as CFDictionary, nil)\n        var error: Unmanaged<CFError>?');
  assert.notEqual(regressed, source);
  assert.throws(() => assertKnownPolicyBeforeKeychainRead(regressed), /Protected metadata/);
});

test('iOS verifies the same protected item and keeps authorization-only operations free of secret reads', () => {
  assertAuthenticatedMetadataBeforeSecret(source);
  assert.match(source, /kSecAttrSynchronizable as String: false/);
  assert.equal((source.match(/SecItemAdd\(/g) ?? []).length, 1);
  assert.doesNotMatch(source, /SecItemUpdate\(/,
    'This private service has no alternate policy writer or imported-item update path');
});

test('secret reads cannot move ahead of the authorization-only boundary', () => {
  const regressed = source.replace('        if !authorizationOnly {', '        query[kSecReturnData as String] = true\n        if !authorizationOnly {');
  assert.throws(() => assertAuthenticatedMetadataBeforeSecret(regressed));
});

test('wrong-policy metadata and opaque ACL comparisons remain rejected', () => {
  const noProtection = source.replace('attributes[kSecAttrAccessible as String] as? String == kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly as String,', '');
  assert.throws(() => assertAuthenticatedMetadataBeforeSecret(noProtection), /Missing authenticated metadata guard/);
  const opaqueComparison = source.replace('        if !authorizationOnly {', '        CFEqual(access, access)\n        if !authorizationOnly {');
  assert.throws(() => assertAuthenticatedMetadataBeforeSecret(opaqueComparison), /private binding state/);
});
