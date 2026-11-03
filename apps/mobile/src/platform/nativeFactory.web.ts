import type { NativeCustodyAuthority } from '../custody/authority.ts';
import type { SeedBackupFlow } from '../custody/seedBackup.ts';

export function createNativeCustodyAuthority(): NativeCustodyAuthority {
  throw new Error('Native custody is unavailable on web');
}

export function createNativeWalletControllers(): { authority: NativeCustodyAuthority; backup: SeedBackupFlow } {
  throw new Error('Native custody is unavailable on web');
}
