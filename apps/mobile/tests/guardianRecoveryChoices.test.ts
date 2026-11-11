import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeAccountId } from '../src/custody/accountIdentity.ts';
import type { NativeCatalogueAccount } from '../src/custody/walletCatalogue.ts';
import { getNativeGuardianRecoveryChoices } from '../src/smartAccount/guardianRecovery.ts';

const address = (value: number) => `0x${value.toString(16).padStart(40, '0')}`;
function account(
  type: NativeCatalogueAccount['type'],
  index: number,
  slip44 = 60,
  smartAccount?: NativeCatalogueAccount['smartAccount']
): NativeCatalogueAccount {
  return {
    id: nativeAccountId(type, index, slip44),
    type,
    index,
    slip44,
    address: address(index + 1),
    label: `${type} ${index}`,
    ...(smartAccount ? { smartAccount } : {}),
  };
}
const smartMetadata = (
  chainId: number,
  isDeployed = true,
  localEcdsa = true
): NonNullable<NativeCatalogueAccount['smartAccount']> => ({
  chainId,
  isDeployed,
  localEcdsa,
  managementAddress: address(100),
});
const choice = ({ id, address, label }: NativeCatalogueAccount) => ({ id, address, label });

test('recovery choices distinguish software owners and fee payers from same-chain Smart guardians', () => {
  const hd = account('HDAccount', 0);
  const imported = account('Imported', 1);
  const smart = account('SmartAccount', 2, 60, smartMetadata(1));
  const choices = getNativeGuardianRecoveryChoices([hd, imported, smart], 1, false);

  assert.deepEqual(choices.guardians, [hd, imported, smart].map(choice));
  assert.deepEqual(choices.replacements, [hd, imported].map(choice));
  assert.deepEqual(choices.payers, [hd, imported].map(choice));
});

test('same-chain Smart guardians remain selectable despite cached deployment or ECDSA capability flags', () => {
  const accounts = [
    account('SmartAccount', 0, 60, smartMetadata(1, false, false)),
    account('SmartAccount', 1, 60, smartMetadata(1, false, true)),
    account('SmartAccount', 2, 60, smartMetadata(1, true, false)),
    account('SmartAccount', 3, 60, smartMetadata(1, true, true)),
  ];
  const choices = getNativeGuardianRecoveryChoices(accounts, 1, false);

  assert.deepEqual(choices.guardians, accounts.map(choice));
  assert.deepEqual(choices.replacements, []);
  assert.deepEqual(choices.payers, []);
});

test('hardware, UTXO and Smart accounts from another chain cannot enter recovery roles', () => {
  const hd = account('HDAccount', 0);
  const imported = account('Imported', 1);
  const excluded = [
    account('Ledger', 2),
    account('Trezor', 3),
    account('HDAccount', 4, 0),
    account('Imported', 5, 57),
    account('Ledger', 6, 57),
    account('Trezor', 7, 0),
    account('SmartAccount', 8, 60, smartMetadata(11155111)),
    account('SmartAccount', 9),
  ];
  const choices = getNativeGuardianRecoveryChoices([hd, ...excluded, imported], 1, false);

  for (const role of ['guardians', 'replacements', 'payers'] as const)
    assert.deepEqual(choices[role], [hd, imported].map(choice), role);
});

test('Smart guardian membership follows the requested chain while software choices remain EVM-wide', () => {
  const hd = account('HDAccount', 0);
  const mainnet = account('SmartAccount', 1, 60, smartMetadata(1));
  const testnet = account('SmartAccount', 2, 60, smartMetadata(11155111, false, false));

  assert.deepEqual(
    getNativeGuardianRecoveryChoices([hd, mainnet, testnet], 11155111, false).guardians,
    [hd, testnet].map(choice)
  );
});

test('public recovery choices are immutable detached identity snapshots with no custody fields', () => {
  const source = {
    ...account('HDAccount', 0),
    xpub: 'public custody record omitted from presentation',
    xprv: 'private sentinel',
    privateKey: 'private sentinel',
    smartAccount: smartMetadata(1),
  };
  const choices = getNativeGuardianRecoveryChoices([source], 1, false);
  const expected = choice(source);
  source.label = 'Changed label';
  source.address = address(200);
  source.id = 'hd:60:200';

  assert(Object.isFrozen(choices));
  for (const role of ['guardians', 'replacements', 'payers'] as const) {
    assert(Object.isFrozen(choices[role]));
    assert.equal(choices[role].length, 1);
    assert(Object.isFrozen(choices[role][0]));
    assert.deepEqual(choices[role][0], expected);
    assert.deepEqual(Object.keys(choices[role][0]!).sort(), ['address', 'id', 'label']);
  }
});

test('an empty catalogue exposes no recovery identity or payer', () => {
  assert.deepEqual(getNativeGuardianRecoveryChoices([], 1, false), {
    passkeysAvailable: false,
    guardians: [],
    replacements: [],
    payers: [],
  });
});
