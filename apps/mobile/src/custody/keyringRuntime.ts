import type { IKeyringAccountState } from '@sidhujag/sysweb3-keyring/cjs/software.js';
import { normalizePublicAddress } from '../core/addresses.ts';
import { RPC_ENDPOINTS } from '../platformRpc.ts';
import type { OpenWalletStorage } from '../storage/types.ts';
import { WalletStorageError } from '../storage/types.ts';
import type { CustodyRuntime, CustodyRuntimeFactory } from './types.ts';
import { CustodyRuntimeError } from './types.ts';

type SoftwareSdk = typeof import('@sidhujag/sysweb3-keyring/cjs/software.js');

export class KeyringRuntimeError extends CustodyRuntimeError {
  constructor(code: KeyringRuntimeError['code']) {
    super(code);
    this.name = 'KeyringRuntimeError';
  }
}

export type KeyringRuntimeDependencies = Readonly<{
  ensureCryptoReady(): Promise<void>;
  openStorage(): Promise<OpenWalletStorage>;
  loadSdk?: () => Promise<SoftwareSdk>;
}>;

/** Internal capability consumed by the epoch-bound backup controller only. */
export interface KeyringRuntime extends CustodyRuntime {
  readonly backup: {
    readPhrase(password: string): Promise<readonly string[]>;
    fingerprint(): Promise<string>;
    confirm(fingerprint: string): Promise<void>;
  };
}

function validPassword(password: unknown, creating: boolean): asserts password is string {
  if (
    typeof password !== 'string' || !password.isWellFormed() ||
    password.length === 0 || new TextEncoder().encode(password).length > 1024 ||
    (creating && [...password].length < 12)
  ) throw new KeyringRuntimeError('INVALID_INPUT');
}

/**
 * Adapt the published software keyring without exposing it, account secrets or
 * storage to a screen. The factory cannot load SDK code before native crypto
 * qualification and cannot silently substitute an in-memory store.
 */
export function createKeyringRuntimeFactory(
  dependencies: KeyringRuntimeDependencies
): CustodyRuntimeFactory {
  return {
    async open(): Promise<KeyringRuntime> {
      await dependencies.ensureCryptoReady();
      const storage = await dependencies.openStorage();
      try {
        const sdk = await (dependencies.loadSdk?.() ?? import('@sidhujag/sysweb3-keyring/cjs/software.js'));
        const host = sdk.createSoftwareKeyringHost(storage.keyringStorage);
        const keyring = new sdk.SoftwareKeyring(host);
        const state = {
          activeAccount: { id: 0, type: sdk.KeyringAccountType.HDAccount },
          activeNetwork: {
            kind: sdk.INetworkType.Ethereum,
            chainId: 1,
            slip44: 60,
            currency: 'ETH',
            label: 'Ethereum',
            url: RPC_ENDPOINTS.ethereum!,
          },
          accounts: {
            HDAccount: {} as Record<number, IKeyringAccountState>,
            Imported: {}, Ledger: {}, Trezor: {}, SmartAccount: {},
          },
        };
        keyring.setVaultStateGetter(() => state);
        let generation = 0;
        let closed = false;
        let active: Promise<unknown> | null = null;
        let closing: Promise<void> | null = null;

        const current = (captured: number) => {
          if (closed || captured !== generation) throw new Error('CANCELLED');
        };
        const lock = (): Promise<void> => {
          generation++;
          // Invoke the SDK now: its secret buffers are retired synchronously.
          const pending = keyring.lockWallet();
          state.accounts.HDAccount = {};
          return pending;
        };
        const run = <T>(operation: (captured: number) => Promise<T>): Promise<T> => {
          if (closed) return Promise.reject(new Error('CANCELLED'));
          if (active) return Promise.reject(new Error('BUSY'));
          const captured = generation;
          // Admit before invoking any injected storage/SDK callback.
          const task = Promise.resolve().then(() => operation(captured));
          const handled = task.catch(async (error: unknown) => {
            const wasCurrent = captured === generation && !closed;
            try { await lock(); }
            catch { closed = true; throw new KeyringRuntimeError('CLEANUP_FAILED'); }
            if (!wasCurrent || closed) throw new KeyringRuntimeError('CANCELLED');
            if (error instanceof KeyringRuntimeError) throw error;
            if (error instanceof WalletStorageError && error.code === 'AUTH_THROTTLED')
              throw new KeyringRuntimeError('AUTH_THROTTLED');
            throw new KeyringRuntimeError('OPERATION_FAILED');
          }).finally(() => { active = null; });
          active = handled;
          return handled;
        };
        const hydrate = async (captured: number) => {
          current(captured);
          const account = await keyring.createFirstAccount();
          current(captured);
          if (
            !account || account.id !== 0 || account.isImported ||
            account.isLedgerWallet || account.isTrezorWallet || account.isSmartAccount
          ) throw new Error('UNAVAILABLE');
          normalizePublicAddress(account.address, 'ethereum');
          state.accounts.HDAccount = { 0: account };
        };
        const authenticate = async (password: string, captured: number) => {
          validPassword(password, false);
          await storage.authGuard.checkAllowed();
          current(captured);
          const result = await keyring.unlock(password);
          if (!result || typeof result.canLogin !== 'boolean') throw new Error('UNAVAILABLE');
          if (!result.canLogin) {
            // A definitive rejected credential still counts when lock/background
            // revokes the session while its unabortable KDF is finishing.
            await storage.authGuard.recordFailure();
            current(captured);
            return false;
          }
          current(captured);
          await storage.authGuard.recordSuccess();
          current(captured);
          return true;
        };
        return {
          session: {
            createWallet: (password) => run(async (captured) => {
              validPassword(password, true);
              current(captured);
              const phrase = keyring.createNewSeed(12);
              if (typeof phrase !== 'string' || !keyring.isSeedValid(phrase)) throw new Error('UNAVAILABLE');
              await keyring.initializeSession(phrase, password);
              current(captured);
              await hydrate(captured);
            }),
            importWallet: (phrase, password) => run(async (captured) => {
              validPassword(password, true);
              if (typeof phrase !== 'string' || !phrase.isWellFormed() || phrase.length > 4096) throw new KeyringRuntimeError('INVALID_INPUT');
              const normalized = phrase.normalize('NFKD').trim().replace(/\s+/gu, ' ');
              if (![12, 24].includes(normalized.split(' ').length) || !keyring.isSeedValid(normalized)) throw new KeyringRuntimeError('INVALID_INPUT');
              current(captured);
              await keyring.initializeSession(normalized, password);
              current(captured);
              await hydrate(captured);
            }),
            unlock: (password) => run(async (captured) => {
              const authenticated = await authenticate(password, captured);
              if (authenticated) await hydrate(captured);
              return { authenticated };
            }),
            async readEthereumAddress() {
              if (closed || !keyring.isUnlocked()) throw new Error('NOT_READY');
              const account = state.accounts.HDAccount[0];
              if (!account) throw new Error('NOT_READY');
              return normalizePublicAddress(account.address, 'ethereum');
            },
            lock,
          },
          storage: {
            readState: () => storage.readState(),
            close() {
              if (!closing) {
                closed = true;
                const work = active;
                const revocation = lock();
                closing = (async () => {
                  await Promise.allSettled([work, revocation]);
                  let failed = false;
                  try { await keyring.lockWallet(); } catch { failed = true; }
                  try { await storage.close(); } catch { failed = true; }
                  if (failed) throw new KeyringRuntimeError('CLEANUP_FAILED');
                })();
              }
              return closing;
            },
          },
          backup: {
            readPhrase: (password) => run(async (captured) => {
              if (!keyring.isUnlocked()) throw new Error('NOT_READY');
              if (!await authenticate(password, captured)) throw new KeyringRuntimeError('INVALID_CREDENTIAL');
              const phrase = await keyring.getSeed(password);
              current(captured);
              if (typeof phrase !== 'string' || !keyring.isSeedValid(phrase)) throw new Error('UNAVAILABLE');
              return Object.freeze(phrase.split(' '));
            }),
            fingerprint: () => storage.getWalletFingerprint(),
            confirm: (fingerprint) => run(async (captured) => {
              if (!keyring.isUnlocked()) throw new Error('NOT_READY');
              current(captured);
              await storage.confirmBackup(fingerprint);
              current(captured);
            }),
          },
        };
      } catch {
        try { await storage.close(); } catch { /* the factory remains unavailable */ }
        throw new Error('UNAVAILABLE');
      }
    },
  };
}
