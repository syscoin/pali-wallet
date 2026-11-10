import { createTestPinCredentialPort } from './fixtures/pinCredential.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { isStrongWalletPassword } from '../../../source/shared/passwordPolicy.ts';
import { isNativeNewPassword, isNativePasswordInput } from '../src/custody/password.ts';
import { NativeRecoveryCoordinator } from '../src/custody/recovery.ts';

const valid = 'Abcdefghij1!';
const cases: readonly [string, string, boolean][] = [
  ['exact twelve characters', valid, true],
  ['eleven characters', 'Abcdefghi1!', false],
  ['lowercase required', 'ABCDEFGHIJ1!', false],
  ['uppercase required', 'abcdefghij1!', false],
  ['ASCII number required', 'Abcdefghijk!', false],
  ['listed symbol required', 'Abcdefghijk1', false],
  ['spaces preserved', '  Abcdefghij1!  ', true],
  ['newline rejected', `${valid}\n`, false],
  ['Unicode line separator rejected', `${valid}\u2028`, false],
  ['ASCII letters are not replaced with accented letters', 'Éééééééééé1!', false],
  ['fullwidth digit is not ASCII number', 'Abcdefghij１!', false],
  ['emoji is not a listed symbol', 'Abcdefghij1😀', false],
  ['existing UTF16 length behavior', 'Aa1!😀😀😀😀', true],
];
for (const [name, input, expected] of cases) {
  test(`shared extension policy: ${name}`, () => {
    assert.equal(isStrongWalletPassword(input), expected);
    assert.equal(isNativeNewPassword(input), expected);
  });
}

test('all existing ASCII special characters remain accepted', () => {
  for (const symbol of `!@#$%^&*()_+-=[]{};':"\\|,.<>/?`) {
    assert.equal(isStrongWalletPassword(`Abcdefghij1${symbol}`), true, symbol);
  }
});

test('native input bounds remain separate from shared password strength', () => {
  for (const input of [null, undefined, 123, {}, []]) {
    assert.equal(isStrongWalletPassword(input), false);
    assert.equal(isNativeNewPassword(input), false);
  }
  assert.equal(isNativeNewPassword(valid + 'x'.repeat(1012)), true);
  assert.equal(isStrongWalletPassword(valid + 'x'.repeat(1013)), true);
  assert.equal(isNativeNewPassword(valid + 'x'.repeat(1013)), false);
  assert.equal(isNativeNewPassword(valid + 'é'.repeat(506)), true);
  assert.equal(isNativeNewPassword(valid + 'é'.repeat(507)), false);
  assert.equal(isStrongWalletPassword(valid + '\ud800'), true);
  assert.equal(isNativeNewPassword(valid + '\ud800'), false);
  // Existing wallet unlock accepts the old credential, even if it is weak.
  assert.equal(isNativePasswordInput('old password'), true);
  assert.equal(isNativeNewPassword('old password'), false);
});

test('recovery rejects invalid PIN input before retiring the wallet or opening storage', async () => {
  let externalCalls = 0;
  const coordinator = new NativeRecoveryCoordinator({
    pinCredential: createTestPinCredentialPort(),
    owner: {
      getSnapshot: () => ({ phase: 'locked', revision: 1 } as never),
      retireForRecovery: async () => { externalCalls++; throw new Error('Must not retire'); },
    },
    retireControllers: async () => { externalCalls++; },
    ensureCryptoReady: async () => { externalCalls++; },
    openStorage: async () => { externalCalls++; throw new Error('Must not open'); },
  });
  for (const password of ['only twelve lowercase letters', 'Abcdefghijk1', 'Abcdefghijk!', valid + 'x'.repeat(1013)]) {
    await assert.rejects(coordinator.prepare('abandon '.repeat(11) + 'about', password, () => undefined), { code: 'INVALID_INPUT' });
  }
  assert.equal(externalCalls, 0);
  coordinator.cancel();
});
