import type { NativeAccountView } from '../custody/accounts.ts';
import type { NativeCustodyAuthority } from '../custody/authority.ts';
import type { SeedBackupFlow } from '../custody/seedBackup.ts';
import type { NativeTransferView } from '../custody/transfers.ts';
import type { NativeTokenView } from '../portfolio/nativeTokens.ts';
import type { NativeActivity } from '../activity/nativeActivity.ts';

export function createNativeCustodyAuthority(): NativeCustodyAuthority {
  throw new Error('Native custody is unavailable on web');
}

export function createNativeWalletControllers(): { authority: NativeCustodyAuthority; backup: SeedBackupFlow; accounts: NativeAccountView; activity: NativeActivity; transfers: NativeTransferView; tokens: NativeTokenView; disposeTokens(): void; disposeTransfers(): void } {
  throw new Error('Native custody is unavailable on web');
}
