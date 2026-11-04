import type { NativeAccountView } from '../custody/accounts.ts';
import type { NativeCustodyAuthority } from '../custody/authority.ts';
import type { SeedBackupFlow } from '../custody/seedBackup.ts';
import type { NativeTransferView } from '../custody/transfers.ts';

export function createNativeCustodyAuthority(): NativeCustodyAuthority {
  throw new Error('Native custody is unavailable on web');
}

export function createNativeWalletControllers(): { authority: NativeCustodyAuthority; backup: SeedBackupFlow; accounts: NativeAccountView; transfers: NativeTransferView; disposeTransfers(): void } {
  throw new Error('Native custody is unavailable on web');
}
