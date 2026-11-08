jest.unmock('syscoinjs-lib');
// No physical device transport is needed by this software-account regression.
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: { on: jest.fn(), dispose: jest.fn().mockResolvedValue(undefined) },
  DEVICE_EVENT: 'device-event',
}));

import { webcrypto } from 'crypto';
import http from 'http';
import https from 'https';

import {
  createUtxoFixture,
  importFixturePsbt,
  UTXO_FIXTURE_SEED,
  verifyFixtureSignature,
} from '../../e2e/harness/utxoFixture';
import { getSyscoinUTXOTestnetNetwork } from '../../source/utils/defaultNetworks';
import { createOfflineTrezorHost } from '../fixtures/extensionKeyring';

const mockBlockbookLookup = jest.fn((...args: unknown[]) => {
  void args;
  throw new Error('Offline signing test must not request Blockbook');
});
jest.mock(
  '@sidhujag/sysweb3-keyring/cjs/utils/owned-blockbook-account',
  () => ({
    fetchOwnedBlockbookAccount: (...args: unknown[]) =>
      mockBlockbookLookup(...args),
  })
);

it('the installed SDK refuses a selected watch-only account without signatures, HD fallback or broadcast', async () => {
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: webcrypto,
  });
  const denyNetwork = () => {
    throw new Error('Offline signing test must not access a network');
  };
  const transports = [
    jest.spyOn(http, 'request').mockImplementation(denyNetwork),
    jest.spyOn(http, 'get').mockImplementation(denyNetwork),
    jest.spyOn(https, 'request').mockImplementation(denyNetwork),
    jest.spyOn(https, 'get').mockImplementation(denyNetwork),
    jest.spyOn(globalThis, 'fetch').mockImplementation(denyNetwork),
  ];
  let manager: any;
  try {
    const fixture = createUtxoFixture();
    const records = new Map<string, unknown>();
    jest.isolateModules(() => {
      const { KeyringManager, HardwareWalletManager, createKeyringHost } =
        jest.requireActual('@sidhujag/sysweb3-keyring');
      const host = createKeyringHost({
        get: async (key: string) => records.get(key),
        async set(key: string, value: unknown) {
          records.set(key, value);
        },
        async deleteItem(key: string) {
          records.delete(key);
        },
        async createManyIfAbsent(items: Record<string, unknown>) {
          if (Object.keys(items).some((key) => records.has(key))) return false;
          for (const [key, value] of Object.entries(items))
            records.set(key, value);
          return true;
        },
      });
      manager = new KeyringManager(host, {
        trezorHost: createOfflineTrezorHost(),
        captureEvmSubmission: () => {
          throw new Error('EVM submission is outside this fixture');
        },
        hardwareManager: new HardwareWalletManager(),
      });
    });
    const vault: any = {
      activeAccount: { id: 0, type: 'HDAccount' },
      activeNetwork: {
        ...getSyscoinUTXOTestnetNetwork(),
        url: 'https://offline.invalid',
      },
      accounts: {
        HDAccount: {
          0: { id: 0, address: fixture.userAddress, xpub: fixture.userXpub },
        },
        // Deliberately select the same public prevout that the available HD
        // seed can sign. This is an SDK record fixture, not a UI-import test.
        Imported: {
          0: {
            id: 0,
            address: fixture.userAddress,
            xpub: fixture.userAddress,
            xprv: '',
            isImported: true,
          },
        },
      },
    };
    manager.setVaultStateGetter(() => vault);
    await manager.initializeSession(
      UTXO_FIXTURE_SEED,
      'PublicFixtureOnly!2026'
    );
    expect(manager.isUnlocked()).toBe(true);
    const transactions = manager.syscoinTransaction;
    const hd = jest.spyOn(manager, 'createOnDemandUTXOSigner');
    const fresh = jest.spyOn(manager, 'createFreshUTXOSigner');
    const mnemonic = jest.spyOn(manager, 'getDecryptedMnemonic');
    const sign = jest.spyOn(transactions, 'signPSBTWithSigner');
    const broadcast = jest.spyOn(transactions, 'sendTransaction');
    const ownedRead = {
      assertCurrent: () => undefined,
      fetch: jest.fn(denyNetwork),
      signal: new AbortController().signal,
    };

    // A real signature control proves that the PSBT, prevout and installed
    // signer work; a parser/scope/setup failure cannot satisfy the negative.
    const signed = await transactions.signPSBT(
      { psbt: JSON.parse(JSON.stringify(fixture.single)) },
      ownedRead
    );
    expect(verifyFixtureSignature(fixture, signed, false)).toBeTruthy();
    expect(hd).toHaveBeenCalledWith(0);
    expect(fresh).toHaveBeenCalled();
    expect(sign).toHaveBeenCalledTimes(1);
    for (const spy of [hd, fresh, mnemonic, sign]) spy.mockClear();

    vault.activeAccount = { id: 0, type: 'Imported' };
    expect(manager.isWatchOnlyAccount(vault.accounts.Imported[0])).toBe(true);
    const request = JSON.parse(JSON.stringify(fixture.single));
    const before = importFixturePsbt(request).toBase64();
    const method = jest.spyOn(transactions, 'signPSBTWithMethod');
    let result: unknown;
    await expect(
      transactions
        .signPSBT({ psbt: request }, ownedRead)
        .then((value: unknown) => {
          result = value;
          return value;
        })
    ).rejects.toThrow('Failed to decrypt imported account key');
    expect(result).toBeUndefined();
    expect(method).toHaveBeenCalledTimes(1);
    const attemptedPsbt = method.mock.calls[0][0] as any;
    expect(attemptedPsbt.toBase64()).toBe(before);
    expect(importFixturePsbt(request).toBase64()).toBe(before);
    for (const input of attemptedPsbt.data.inputs)
      for (const field of [
        'partialSig',
        'finalScriptSig',
        'finalScriptWitness',
        'tapKeySig',
        'tapScriptSig',
      ])
        expect(input[field]).toBeUndefined();
    for (const spy of [hd, fresh, mnemonic, sign, broadcast])
      expect(spy).not.toHaveBeenCalled();
    expect(mockBlockbookLookup).not.toHaveBeenCalled();
    expect(ownedRead.fetch).not.toHaveBeenCalled();
    for (const transport of transports)
      expect(transport).not.toHaveBeenCalled();
  } finally {
    await manager?.destroy();
    jest.restoreAllMocks();
    if (originalCrypto)
      Object.defineProperty(globalThis, 'crypto', originalCrypto);
  }
});
