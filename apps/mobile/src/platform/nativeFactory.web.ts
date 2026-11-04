import type { NativeImportView } from '../custody/importedAccounts.ts';
import type { NativeAccountView } from '../custody/accounts.ts';
import type { NativeCustodyAuthority } from '../custody/authority.ts';
import type { SeedBackupFlow } from '../custody/seedBackup.ts';
import type { HdKeyExportFlow } from '../custody/hdKeyExport.ts';
import type { NativeTransferView } from '../custody/transfers.ts';
import type { NativeTokenView } from '../portfolio/nativeTokens.ts';
import type { NativeActivity } from '../activity/nativeActivity.ts';
import type { BalanceReader } from '../core/watchOnlyAuthority.ts';
import type { NativeRecoveryCoordinator } from '../custody/recovery.ts';

export function createNativeRecoveryCoordinator(_controllers: ReturnType<typeof createNativeWalletControllers>): NativeRecoveryCoordinator {
  throw new Error('Native recovery is unavailable on web');
}

export function createNativeCustodyAuthority(): NativeCustodyAuthority {
  throw new Error('Native custody is unavailable on web');
}

export function createNativeWalletControllers(): { authority: NativeCustodyAuthority; backup: SeedBackupFlow; keyExport: HdKeyExportFlow; imports: NativeImportView; accounts: NativeAccountView; activity: NativeActivity; balanceReader: BalanceReader; transfers: NativeTransferView; tokens: NativeTokenView; disposeTokens(): void; disposeTransfers(): void } {
  throw new Error('Native custody is unavailable on web');
}
