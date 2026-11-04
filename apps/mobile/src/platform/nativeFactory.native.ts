import { NativeCustodyAuthority } from '../custody/authority.ts';
import { createKeyringRuntimeFactory } from '../custody/keyringRuntime.ts';
import type { KeyringRuntime } from '../custody/keyringRuntime.ts';
import { SeedBackupFlow } from '../custody/seedBackup.ts';
import { HdKeyExportFlow } from '../custody/hdKeyExport.ts';
import { NativeTransfers } from '../custody/transfers.ts';
import { NativeTokens } from '../portfolio/nativeTokens.ts';
import { NativeActivity } from '../activity/nativeActivity.ts';
import type { NativeImportView } from '../custody/importedAccounts.ts';
import type { NativeAccountView } from '../custody/accounts.ts';
import { openNativeWalletStorage } from '../storage/native';
import { ensureNativeCryptoReady } from './cryptoBootstrap';

function factory() {
  return createKeyringRuntimeFactory({
    ensureCryptoReady: async () => { await ensureNativeCryptoReady(); },
    openStorage: async () => {
      const crypto = await ensureNativeCryptoReady();
      return openNativeWalletStorage({
        randomBytes(length) { return crypto.getRandomValues(new Uint8Array(length)); },
        async digest(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); },
      });
    },
  });
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
  const transfers = new NativeTransfers(authority, () => runtime?.transfers);
  const tokens = new NativeTokens(authority, () => runtime?.tokens, undefined, Date.now, () => authority.lock());
  const activity = new NativeActivity(authority, () => runtime?.activity);
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
  return { authority, backup, keyExport, imports, accounts, activity, transfers: transfers.view, tokens: tokens.view,
    disposeTokens: () => tokens.dispose(), disposeTransfers: () => transfers.dispose() };
}
