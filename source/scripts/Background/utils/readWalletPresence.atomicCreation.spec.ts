jest.unmock('syscoinjs-lib');
jest.unmock('tiny-secp256k1');
// Keep the vault/storage integration real without opening a hardware transport.
jest.mock('@trezor/connect-webextension', () => ({
  __esModule: true,
  default: {
    on: jest.fn(),
    dispose: jest.fn().mockResolvedValue(undefined),
  },
  DEVICE_EVENT: 'device-event',
}));

import { webcrypto } from 'crypto';

import { readWalletPresence } from './readWalletPresence';

describe('fresh keyring creation persistence', () => {
  it('leaves no partial wallet after a rejected native batch, then permits a complete retry', async () => {
    const originalCrypto = Object.getOwnPropertyDescriptor(
      globalThis,
      'crypto'
    );
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: webcrypto,
    });
    const records: Record<string, unknown> = {};
    let failVaultWrite = true;
    const writes: Array<Record<string, unknown>> = [];
    const nativeArea = {
      get: jest.fn(async (keys: string[]) =>
        Object.fromEntries(keys.map((key) => [key, records[key]]))
      ),
      set: jest.fn(async (items: Record<string, unknown>) => {
        writes.push(items);
        if ('sysweb3-vault' in items && failVaultWrite) {
          failVaultWrite = false;
          throw new Error('native storage write rejected');
        }
        Object.assign(records, items);
      }),
      remove: jest.fn(async (key: string) => {
        delete records[key];
      }),
      createItemsIfAbsent: jest.fn(
        async (items: Record<string, string>): Promise<boolean> => {
          if (
            Object.keys(items).some(
              (key) => records[key] !== undefined && records[key] !== null
            )
          )
            return false;
          // The test backend commits synchronously inside set before its
          // promise settles, including the simulated rejection above.
          await nativeArea.set(
            Object.fromEntries(
              Object.entries(items).map(([key, value]) => [
                key,
                JSON.parse(value),
              ])
            )
          );
          return true;
        }
      ),
    };
    const get = jest.spyOn(chrome.storage.local, 'get').mockImplementation(((
      keys: string[],
      callback: (value: object) => void
    ) => {
      callback(Object.fromEntries(keys.map((key) => [key, records[key]])));
    }) as any);
    const { KeyringManager } = jest.requireActual('@sidhujag/sysweb3-keyring');
    const keyring: any = new KeyringManager();
    keyring.setStorage(nativeArea);
    // Test the real encryption/persistence path without spending time on KDF;
    // this public fixture key carries no wallet secret.
    keyring.deriveStoredSessionKey = jest.fn(async () => '42'.repeat(32));
    keyring.recreateSessionFromVault = jest.fn(async () => undefined);
    const phrase =
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    try {
      await expect(
        keyring.initializeSession(phrase, 'public fixture password')
      ).rejects.toThrow('native storage write rejected');
      expect(records['sysweb3-vault']).toBeUndefined();
      expect(records['sysweb3-vault-keys']).toBeUndefined();
      await expect(readWalletPresence()).resolves.toBe(false);
      expect(writes).toHaveLength(1);
      expect(Object.keys(writes[0]).sort()).toEqual([
        'sysweb3-vault',
        'sysweb3-vault-keys',
      ]);

      await keyring.initializeSession(phrase, 'public fixture password');
      await expect(readWalletPresence()).resolves.toBe(true);
      expect(records['sysweb3-vault-keys']).toEqual({
        salt: expect.any(String),
      });
      expect(JSON.parse(records['sysweb3-vault'] as string).alg).toBe(
        'A256GCM'
      );
    } finally {
      get.mockRestore();
      await keyring.destroy();
      if (originalCrypto)
        Object.defineProperty(globalThis, 'crypto', originalCrypto);
    }
  });
});
