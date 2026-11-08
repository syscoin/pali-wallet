import QuickCrypto from 'react-native-quick-crypto';
import {
  createSentryShakeExecutor,
  type NativeSlhDsaConstructor,
} from '../src/crypto/sentryShakeExecutor.ts';

export const SENTRY_SHAKE_CHECK = 'native Sentry SHAKE-128s import vector';

// Public, fixed Sentry vector. This module is used only by the isolated
// qualification entry after native crypto and Nitro have been initialized.
const expected =
  '37373737373737373737373737373737df7468cb62f0ff4e6ec27cbe18019216';
function vector() {
  const key = new Uint8Array(64);
  key.fill(0x37, 0, 48);
  key.set(
    [223, 116, 104, 203, 98, 240, 255, 78, 110, 194, 124, 190, 24, 1, 146, 22],
    48
  );
  return key;
}

async function expectRejected(operation: Promise<unknown>, message: string) {
  try {
    await operation;
  } catch (error) {
    if (error instanceof Error && error.message === message) return;
  }
  throw new Error('QUALIFICATION_SENTRY_REJECTION_FAILED');
}

export async function qualifyNativeSentryShake(signal: AbortSignal) {
  const SlhDsa: unknown = Reflect.get(QuickCrypto, 'SlhDsa');
  if (typeof SlhDsa !== 'function') throw new Error('SENTRY_SHAKE_UNAVAILABLE');
  const derive = createSentryShakeExecutor(SlhDsa as NativeSlhDsaConstructor);
  const start = (bytes: Uint8Array<ArrayBuffer>, owner: AbortSignal) => {
    try {
      return derive('operator', 'slh-dsa-shake-128s', bytes, owner);
    } finally {
      bytes.fill(0);
    }
  };

  const valid = () => start(vector(), signal);
  if ((await valid()) !== expected)
    throw new Error('QUALIFICATION_SENTRY_VECTOR_FAILED');

  const corrupt = vector();
  corrupt[63]! ^= 1;
  await expectRejected(
    start(corrupt, signal),
    'SENTRY_SHAKE_VALIDATION_FAILED'
  );

  const retired = new AbortController();
  const draining = start(vector(), retired.signal);
  retired.abort();
  await expectRejected(draining, 'CANCELLED');

  if ((await valid()) !== expected)
    throw new Error('QUALIFICATION_SENTRY_REUSE_FAILED');
  return derive;
}
