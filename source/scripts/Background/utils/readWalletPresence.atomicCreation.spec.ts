jest.unmock('syscoinjs-lib');
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
    const oldStorage = Object.getOwnPropertyDescriptor(chrome.storage, 'local');
    const oldNavigator = Object.getOwnPropertyDescriptor(
      globalThis,
      'navigator'
    );
    const nativeArea = {
      get(keys: string[], callback?: (value: object) => void) {
        const selected = Object.fromEntries(
          keys.map((key) => [key, records[key]])
        );
        callback?.(selected);
        return Promise.resolve(selected);
      },
      async set(items: Record<string, unknown>) {
        if ('sysweb3-vault' in items) {
          writes.push(items);
          if (failVaultWrite) {
            failVaultWrite = false;
            throw new Error('native storage write rejected');
          }
        }
        Object.assign(records, items);
      },
      async remove(key: string) {
        delete records[key];
      },
    };
    Object.defineProperty(chrome.storage, 'local', {
      configurable: true,
      value: nativeArea,
    });
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        locks: {
          request: (
            _key: string,
            _options: unknown,
            operation: () => unknown
          ) => operation(),
        },
      },
    });
    const { KeyringManager, HardwareWalletManager } = jest.requireActual(
      '@sidhujag/sysweb3-keyring'
    );
    const { createBrowserKeyringHost } = jest.requireActual(
      '../controllers/browserKeyringHost'
    );
    const keyring: any = new KeyringManager(
      createBrowserKeyringHost(chrome.storage.local),
      {
        captureEvmSubmission: () => {
          throw new Error('EVM submission is outside this fixture');
        },
        hardwareManager: new HardwareWalletManager(),
      }
    );
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
      await keyring.destroy();
      if (oldStorage)
        Object.defineProperty(chrome.storage, 'local', oldStorage);
      if (oldNavigator)
        Object.defineProperty(globalThis, 'navigator', oldNavigator);
      else Reflect.deleteProperty(globalThis, 'navigator');
      if (originalCrypto)
        Object.defineProperty(globalThis, 'crypto', originalCrypto);
    }
  });
});
