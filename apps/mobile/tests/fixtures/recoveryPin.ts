import { isNativePin } from '../../src/custody/pinVault.ts';
import { RecoveryError, type NativeRecoveryCoordinator } from '../../src/custody/recovery.ts';

/** Tests that need a commit-ready plan still exercise both required public steps. */
export async function prepareRecoveryPin(coordinator: NativeRecoveryCoordinator, phrase: string, pin: string, guard: () => void) {
  if (!isNativePin(pin)) throw new RecoveryError('INVALID_INPUT');
  const proof = await coordinator.prepare(phrase, guard);
  await coordinator.setPin(proof, pin);
  return proof;
}
