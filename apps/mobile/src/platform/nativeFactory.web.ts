import type { NativeCustodyAuthority } from '../custody/authority.ts';
import type { NativeRecoveryCoordinator } from '../custody/recovery.ts';

type NativeWalletControllers = ReturnType<typeof import('./nativeFactory.native.ts').createNativeWalletControllers>;

export function createNativeRecoveryCoordinator(_controllers: ReturnType<typeof createNativeWalletControllers>): NativeRecoveryCoordinator {
  throw new Error('Native recovery is unavailable on web');
}

export function createNativeCustodyAuthority(): NativeCustodyAuthority {
  throw new Error('Native custody is unavailable on web');
}

export function createNativeWalletControllers(): NativeWalletControllers {
  throw new Error('Native custody is unavailable on web');
}
