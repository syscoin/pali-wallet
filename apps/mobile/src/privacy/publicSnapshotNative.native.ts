import { requireNativeModule } from 'expo-modules-core';
import { createPublicSnapshotTransport, type PublicSnapshotModule } from './publicSnapshotTransport.ts';

export function createNativePublicSnapshotTransport() {
  return createPublicSnapshotTransport(requireNativeModule<PublicSnapshotModule>('PaliWalletStorage'));
}
