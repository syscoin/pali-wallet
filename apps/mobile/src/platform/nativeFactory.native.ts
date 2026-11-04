import { NativeCustodyAuthority } from '../custody/authority.ts';
import { createKeyringRuntimeFactory } from '../custody/keyringRuntime.ts';
import type { KeyringRuntime } from '../custody/keyringRuntime.ts';
import { SeedBackupFlow } from '../custody/seedBackup.ts';
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
  return { authority, backup };
}
