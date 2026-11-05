import { EvmTransferReadRpc } from '../custody/evmTransferReadRpc.ts';
import { custodyIdle, securityPreferences } from './security';
import { CustodyOperationError, NativeCustodyAuthority } from '../custody/authority.ts';
import { createKeyringRuntimeFactory } from '../custody/keyringRuntime.ts';
import type { KeyringRuntime } from '../custody/keyringRuntime.ts';
import { SeedBackupFlow } from '../custody/seedBackup.ts';
import { HdKeyExportFlow } from '../custody/hdKeyExport.ts';
import { NativeTransfers } from '../custody/transfers.ts';
import { NativeTokens } from '../portfolio/nativeTokens.ts';
import { NativeActivity } from '../activity/nativeActivity.ts';
import { ActivityExplorerReader } from '../activity/explorerReader.ts';
import { ActivityReceiptReader } from '../activity/receiptReader.ts';
import { createErc20Reader } from '../portfolio/erc20ReadRpc.ts';
import { createBalanceReader } from '../platformRpc.ts';
import { walletFetch } from './http';
import type { NativeImportView } from '../custody/importedAccounts.ts';
import type { NativeAccountView } from '../custody/accounts.ts';
import { openNativeWalletStorage } from '../storage/native';
import { ensureNativeCryptoReady } from './cryptoBootstrap';
import { NativeRecoveryCoordinator } from '../custody/recovery.ts';
import { readRecoveryInventory as readStoredRecoveryInventory, type RecoveryInventory } from '../custody/recoveryInventory.ts';
import type { OpenWalletStorage } from '../storage/types.ts';

async function openStorage() {
  const crypto = await ensureNativeCryptoReady();
  return openNativeWalletStorage({
    randomBytes(length) { return crypto.getRandomValues(new Uint8Array(length)); },
    async digest(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); },
  });
}

function custodyGuard() {
  const guard = custodyIdle.captureGuard();
  return () => { if (securityPreferences.getSnapshot().status !== 'ready') throw new Error('CANCELLED'); guard(); };
}
function factory(onStorageOpened?: (storage: OpenWalletStorage) => void, assertActive = custodyGuard()) {
  return createKeyringRuntimeFactory({
    assertActive,
    observeActivity(network, expected, signal, guard) {
      return new EvmTransferReadRpc(network, { fetch: walletFetch }).observation({ hash: expected.hash, from: expected.from, to: expected.to, nonce: expected.nonce }, signal, guard);
    },
    ensureCryptoReady: async () => { await ensureNativeCryptoReady(); },
    openStorage: async () => {
      const storage = await openStorage();
      onStorageOpened?.(storage);
      return storage;
    },
  });
}

/** Backend capability only; the recovery UI must own its lifecycle guard/disposal. */
export function createNativeRecoveryCoordinator(controllers: ReturnType<typeof createNativeWalletControllers>) {
  return new NativeRecoveryCoordinator({ owner: controllers.authority,
    retireControllers() { controllers.disposeTokens(); controllers.disposeTransfers(); controllers.keyExport.dispose(); controllers.backup.dispose(); },
    ensureCryptoReady: async () => { await ensureNativeCryptoReady(); }, openStorage, assertActive: custodyGuard() });
}

export function createNativeCustodyAuthority(): NativeCustodyAuthority {
  return new NativeCustodyAuthority(factory());
}

export function createNativeWalletControllers() {
  let runtime: KeyringRuntime | undefined;
  let ownedStorage: OpenWalletStorage | undefined;
  const assertActive = custodyGuard();
  const base = factory((storage) => { ownedStorage = storage; }, assertActive);
  const authority = new NativeCustodyAuthority({
    async open() { runtime = await base.open() as KeyringRuntime; return runtime; },
  }, { preferences: securityPreferences, assertActive });
  const backup = new SeedBackupFlow(authority, () => runtime?.backup);
  const keyExport = new HdKeyExportFlow(authority, () => runtime?.keyExport);
  const balanceReader = createBalanceReader({ fetch: walletFetch, registrations: () => authority.getCatalogue()?.networks });
  const transfers = new NativeTransfers(authority, () => runtime?.transfers, { fetch: walletFetch });
  const tokens = new NativeTokens(authority, () => runtime?.tokens, createErc20Reader({ fetch: walletFetch, registrations: () => authority.getCatalogue()?.networks }), Date.now, () => authority.lock());
  const activity = new NativeActivity(authority, () => runtime?.activity,
    new ActivityExplorerReader(walletFetch), new ActivityReceiptReader({ fetch: walletFetch }));
  const accounts: NativeAccountView = Object.freeze({
    getSnapshot: () => authority.getCatalogue(),
    getContextRevision: () => authority.getSnapshot().revision,
    subscribe: (listener: () => void) => authority.subscribe(() => listener()),
    execute: (...args: Parameters<NativeAccountView['execute']>) => authority.manageAccounts(...args),
    cancel: () => authority.cancelAccountOperation(),
  });
  const imports: NativeImportView = Object.freeze({
    submit: (...args: Parameters<NativeImportView['submit']>) => authority.importEvmAccount(...args),
    cancel: () => authority.cancelAccountOperation(),
  });
  // Public counts from this owner's existing lease only; never retire or reopen it.
  const readRecoveryInventory = async (): Promise<RecoveryInventory> => {
    const storage = ownedStorage;
    if (!storage) throw new CustodyOperationError('CANCELLED');
    const revision = authority.getSnapshot().revision;
    const assertCurrent = () => {
      const snapshot = authority.getSnapshot();
      if (ownedStorage !== storage || snapshot.phase !== 'locked' || snapshot.revision !== revision)
        throw new CustodyOperationError('CANCELLED');
    };
    assertCurrent();
    const inventory = await readStoredRecoveryInventory(storage);
    assertCurrent();
    return inventory;
  };
  return { authority, backup, keyExport, imports, accounts, activity, balanceReader, readRecoveryInventory, transfers: transfers.view, tokens: tokens.view,
    disposeTokens: () => tokens.dispose(), disposeTransfers: () => transfers.dispose() };
}
