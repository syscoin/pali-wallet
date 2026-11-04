import { NativeCustodyAuthority } from '../custody/authority.ts';
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

async function openStorage() {
  const crypto = await ensureNativeCryptoReady();
  return openNativeWalletStorage({
    randomBytes(length) { return crypto.getRandomValues(new Uint8Array(length)); },
    async digest(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); },
  });
}

function factory() {
  return createKeyringRuntimeFactory({
    ensureCryptoReady: async () => { await ensureNativeCryptoReady(); },
    openStorage,
  });
}

/** Backend capability only; the recovery UI must own its lifecycle guard/disposal. */
export function createNativeRecoveryCoordinator(controllers: ReturnType<typeof createNativeWalletControllers>) {
  return new NativeRecoveryCoordinator({ owner: controllers.authority,
    retireControllers() { controllers.disposeTokens(); controllers.disposeTransfers(); controllers.keyExport.dispose(); controllers.backup.dispose(); },
    ensureCryptoReady: async () => { await ensureNativeCryptoReady(); }, openStorage });
}

export function createNativeCustodyAuthority(): NativeCustodyAuthority {
  return new NativeCustodyAuthority(factory());
}

export function createNativeWalletControllers() {
  let runtime: KeyringRuntime | undefined;
  const base = factory();
  const authority = new NativeCustodyAuthority({
    async open() { runtime = await base.open() as KeyringRuntime; return runtime; },
  });
  const backup = new SeedBackupFlow(authority, () => runtime?.backup);
  const keyExport = new HdKeyExportFlow(authority, () => runtime?.keyExport);
  const balanceReader = createBalanceReader({ fetch: walletFetch });
  const transfers = new NativeTransfers(authority, () => runtime?.transfers, { fetch: walletFetch });
  const tokens = new NativeTokens(authority, () => runtime?.tokens, createErc20Reader({ fetch: walletFetch }), Date.now, () => authority.lock());
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
  return { authority, backup, keyExport, imports, accounts, activity, balanceReader, transfers: transfers.view, tokens: tokens.view,
    disposeTokens: () => tokens.dispose(), disposeTransfers: () => transfers.dispose() };
}
