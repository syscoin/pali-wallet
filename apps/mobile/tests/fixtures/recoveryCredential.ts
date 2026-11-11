import type { NativeRecoveryCoordinator } from '../../src/custody/recovery.ts';
/** Produces only the real phrase proof; credential staging occurs inside commit. */
export async function prepareRecoveryCredential(coordinator: NativeRecoveryCoordinator, phrase: string, guard: () => void) {
  return coordinator.prepare(phrase, guard);
}
