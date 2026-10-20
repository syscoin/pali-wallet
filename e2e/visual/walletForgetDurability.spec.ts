import { expect, test, type Worker } from '@playwright/test';

import { E2E_CONFIG } from '../harness/config';
import {
  createIsolatedVaultFixture,
  installIsolatedVaultRoutes,
} from '../harness/isolatedVaultFixture';
import { PaliWallet } from '../harness/pali';
import {
  startUtxoFixtureServer,
  UTXO_FIXTURE_SEED,
} from '../harness/utxoFixture';

const PASSWORD = 'ForgetDurabilitySynthetic!2026';

async function forget(wallet: PaliWallet) {
  // This is the exact trusted operation used by the Forget page, without
  // opening its seed-confirmation view or exporting any secret from the worker.
  return wallet.page.evaluate(
    (password) =>
      new Promise<{ error?: string; failed: boolean }>((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: 'CONTROLLER_ACTION',
            data: { methods: ['wallet', 'forgetWallet'], params: [password] },
          },
          (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            const error =
              typeof result?.error === 'string'
                ? result.error
                : result?.error?.message;
            resolve({
              failed: Boolean(result?.error || result?.success === false),
              ...(error ? { error } : {}),
            });
          }
        );
      }),
    PASSWORD
  );
}

async function installStorageProbe(worker: Worker, failSecondary: boolean) {
  return worker.evaluate(async (shouldFail) => {
    const scope = globalThis as any;
    const owned = (key: string) =>
      key === 'sysweb3-vault' ||
      key === 'sysweb3-vault-keys' ||
      key.startsWith('sysweb3-vault-') ||
      key === 'state' ||
      key.startsWith('state-') ||
      key.startsWith('pali-slh-dsa-state:') ||
      key.startsWith('pali-slh-dsa-precompute:') ||
      key.startsWith('pali-slh-dsa-smart-account-setup:') ||
      key.startsWith('pali-slh-dsa-prepared-smart-account-signer:v1:') ||
      key.startsWith('sentry-operator-v1:') ||
      key.startsWith('sentry-settings-v1:') ||
      key.startsWith('sentry-collateral-v1:') ||
      key.startsWith('sentry-linked-v1:');
    const read = () =>
      new Promise<Record<string, any>>((resolve, reject) => {
        chrome.storage.local.get(null, (records) => {
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(records);
        });
      });
    const digest = async (value: unknown) => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(hash), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
    };
    const original = await read();
    const protectedKeys = Object.keys(original).filter(
      (key) =>
        key === 'sysweb3-vault' ||
        key === 'sysweb3-vault-keys' ||
        /^state-vault-\d+(?:-passkey-profile)?$/.test(key)
    );
    const hashes = Object.fromEntries(
      await Promise.all(
        protectedKeys.map(async (key) => [key, await digest(original[key])])
      )
    );
    const local = chrome.storage.local;
    const originalRemove = local.remove;
    const originalSend = chrome.runtime.sendMessage;
    const probe = {
      armed: shouldFail,
      failures: 0,
      forgottenEvents: 0,
      inspect: async () => {
        const records = await read();
        const matches = Object.fromEntries(
          await Promise.all(
            protectedKeys.map(async (key) => [
              key,
              records[key] !== undefined &&
                (await digest(records[key])) === hashes[key],
            ])
          )
        );
        return {
          rootsPresent: Boolean(
            typeof records['sysweb3-vault'] === 'string' &&
              records['sysweb3-vault'].length &&
              records['sysweb3-vault-keys']
          ),
          secondaryPresent: Boolean(records['state-vault-60']),
          rootPairMatches: ['sysweb3-vault', 'sysweb3-vault-keys'].every(
            (key) => matches[key] === true
          ),
          secondaryRecordsMatch: protectedKeys
            .filter((key) => key.startsWith('state-vault-'))
            .every((key) => matches[key] === true),
          ownedKeys: Object.keys(records).filter(
            (key) =>
              owned(key) && records[key] !== undefined && records[key] !== null
          ),
          journalPresent:
            records['pali-wallet-recovery-journal:v1'] !== undefined &&
            records['pali-wallet-recovery-journal:v1'] !== null,
          failures: probe.failures,
          forgottenEvents: probe.forgottenEvents,
        };
      },
      restore: () => {
        local.remove = originalRemove;
        chrome.runtime.sendMessage = originalSend;
        delete scope.__walletForgetDurabilityProbe;
      },
    };
    scope.__walletForgetDurabilityProbe = probe;
    local.remove = ((keys: string | string[], ...args: any[]) => {
      if (
        probe.armed &&
        (Array.isArray(keys) ? keys : [keys]).includes('state-vault-60')
      ) {
        probe.armed = false;
        probe.failures += 1;
        // chromeStorage.removeItem wraps this real call in a Promise executor;
        // the synchronous throw rejects just this removal. Other removals still
        // execute normally, so rollback must handle a genuinely partial erase.
        throw new Error('Synthetic secondary vault removal failure');
      }
      return (originalRemove as any).call(local, keys, ...args);
    }) as typeof local.remove;
    chrome.runtime.sendMessage = ((...args: any[]) => {
      if (args[0]?.type === 'wallet_forgotten') probe.forgottenEvents += 1;
      return (originalSend as any).apply(chrome.runtime, args);
    }) as typeof chrome.runtime.sendMessage;
    return probe.inspect();
  }, failSecondary);
}

const inspectStorage = (worker: Worker) =>
  worker.evaluate(() =>
    (globalThis as any).__walletForgetDurabilityProbe.inspect()
  );

test.describe('authenticated wallet forgetting durability', () => {
  for (const failSecondary of [false, true]) {
    test(
      failSecondary
        ? 'restores partially removed storage and permits an unlocked retry'
        : 'removes every wallet-owned record with the real store subscribers active',
      async () => {
        const previous = { ...E2E_CONFIG };
        const server = await startUtxoFixtureServer();
        Object.assign(E2E_CONFIG, {
          seedPhrase: UTXO_FIXTURE_SEED,
          password: PASSWORD,
          rpcUrl: server.url,
        });
        let wallet: PaliWallet | undefined;
        let status: 'passed' | 'failed' = 'failed';
        let worker: Worker | undefined;
        try {
          wallet = await PaliWallet.launch(
            failSecondary ? 'wallet-forget-rollback' : 'wallet-forget-healthy',
            { offlineHttpProxy: server.url }
          );
          const routes = await installIsolatedVaultRoutes(
            wallet.context,
            createIsolatedVaultFixture(),
            server.url
          );
          await wallet.importSeedAndCreatePassword();
          await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
          await wallet.switchNetwork('Syscoin NEVM Testnet', 'EVM');
          await wallet.switchNetwork('Syscoin Testnet', 'UTXO');
          await wallet.ensureOnHome();
          worker = wallet.context
            .serviceWorkers()
            .find((candidate) =>
              candidate
                .url()
                .startsWith(`chrome-extension://${wallet!.extensionId}/`)
            );
          expect(
            worker,
            'the verified extension worker is present'
          ).toBeDefined();
          const before = await installStorageProbe(worker!, failSecondary);
          expect(before).toMatchObject({
            rootsPresent: true,
            secondaryPresent: true,
            rootPairMatches: true,
            secondaryRecordsMatch: true,
            journalPresent: false,
            failures: 0,
            forgottenEvents: 0,
          });
          expect(before.ownedKeys).toContain('state-vault-60');

          const first = await forget(wallet);
          if (failSecondary) {
            expect(first.failed).toBe(true);
            expect(first.error).toContain(
              'Synthetic secondary vault removal failure'
            );
            const restored = await inspectStorage(worker!);
            expect(restored).toMatchObject({
              rootsPresent: true,
              secondaryPresent: true,
              rootPairMatches: true,
              secondaryRecordsMatch: true,
              journalPresent: false,
              failures: 1,
              forgottenEvents: 0,
            });
            // The real rollback locks the keyrings. Reauthenticate through the
            // ordinary login UI before retrying the exact removal operation.
            await wallet.gotoRoute('#/');
            await expect(wallet.page.locator('#login #password')).toBeVisible();
            await wallet.unlock();
            await wallet.ensureOnHome();
            expect(await forget(wallet)).toEqual({ failed: false });
          } else {
            expect(first).toEqual({ failed: false });
          }

          await expect
            .poll(() => inspectStorage(worker!))
            .toMatchObject({
              rootsPresent: false,
              secondaryPresent: false,
              ownedKeys: [],
              journalPresent: false,
              failures: failSecondary ? 1 : 0,
              forgottenEvents: 1,
            });
          await expect
            .poll(() =>
              wallet!.page.evaluate(
                () =>
                  new Promise<{
                    accounts: {
                      emptyAddress: boolean;
                      emptyPrivateKey: boolean;
                      emptyPublicKey: boolean;
                      id: number;
                      imported: boolean;
                      label: string;
                      ledger: boolean;
                      slot: string;
                      smart: boolean;
                      trezor: boolean;
                      type: string;
                    }[];
                    activeAccount: { id: number; type: string };
                    encrypted: boolean;
                  }>((resolve, reject) => {
                    chrome.runtime.sendMessage(
                      { type: 'getCurrentState' },
                      (state) => {
                        if (chrome.runtime.lastError || !state?.vault) {
                          reject(new Error('Live wallet state unavailable'));
                          return;
                        }
                        resolve({
                          accounts: Object.entries(
                            state.vault.accounts || {}
                          ).flatMap(([type, entries]) =>
                            Object.entries(entries || {}).map(
                              ([slot, account]: [string, any]) => ({
                                type,
                                slot,
                                id: account.id,
                                label: account.label,
                                emptyAddress: account.address === '',
                                emptyPublicKey: account.xpub === '',
                                emptyPrivateKey: account.xprv === '',
                                imported: Boolean(account.isImported),
                                ledger: Boolean(account.isLedgerWallet),
                                trezor: Boolean(account.isTrezorWallet),
                                smart: Boolean(account.isSmartAccount),
                              })
                            )
                          ),
                          activeAccount: state.vault.activeAccount,
                          encrypted: state.vaultGlobal.hasEncryptedVault,
                        });
                      }
                    );
                  })
              )
            )
            // forgetWallet intentionally restores the initial HD0 placeholder,
            // not an empty account map. Permit only that exact non-signing
            // identity; no address, public/private key or imported/hardware/
            // smart account may survive. No key material leaves the document.
            .toEqual({
              accounts: [
                {
                  type: 'HDAccount',
                  slot: '0',
                  id: 0,
                  label: 'Account 1',
                  emptyAddress: true,
                  emptyPublicKey: true,
                  emptyPrivateKey: true,
                  imported: false,
                  ledger: false,
                  trezor: false,
                  smart: false,
                },
              ],
              activeAccount: { id: 0, type: 'HDAccount' },
              encrypted: false,
            });
          await wallet.gotoRoute('#/');
          await expect(
            wallet.page.locator('#import-wallet-link')
          ).toBeVisible();
          expect(routes.deniedWrites).toEqual([]);
          if (test.info().errors.length === 0) status = 'passed';
        } finally {
          try {
            await worker
              ?.evaluate(() =>
                (globalThis as any).__walletForgetDurabilityProbe?.restore()
              )
              .catch(() => undefined);
          } catch (error) {
            status = 'failed';
            throw error;
          } finally {
            try {
              await wallet?.dispose(status);
            } finally {
              try {
                await server.close();
              } finally {
                Object.assign(E2E_CONFIG, previous);
              }
            }
          }
        }
      }
    );
  }
});
