import { ensureNativeCryptoReady } from '../platform/cryptoBootstrap';
import { createSentryClassicalExecutor } from './sentryClassicalExecutor';
import { createSentryPublicKeyDeriver } from './sentryPublicKeyExecutor.ts';
import {
  createSentryShakeExecutor,
  type NativeSentryKeyFactory,
} from './sentryShakeExecutor';
import type { DeriveSentryPublicKey } from '../custody/sentryKeyManagement';

/** Scheme-specific loaders preserve the same shared SDK and native validators. */
export function createNativeSentryPublicKeyDeriver(): DeriveSentryPublicKey {
  let classical: Promise<DeriveSentryPublicKey> | undefined;
  let shake: Promise<DeriveSentryPublicKey> | undefined;
  return createSentryPublicKeyDeriver((scheme) => {
    if (scheme === 'slh-dsa-shake-128s') {
      shake ??= ensureNativeCryptoReady().then(async () => {
        const { default: crypto } = await import('react-native-quick-crypto');
        const createPrivateKeyAsync: unknown = Reflect.get(crypto, 'createPrivateKeyAsync');
        const createPublicKey: unknown = Reflect.get(crypto, 'createPublicKey');
        if (typeof createPrivateKeyAsync !== 'function' || typeof createPublicKey !== 'function')
          throw new Error('SENTRY_SHAKE_UNAVAILABLE');
        return createSentryShakeExecutor(
          { createPrivateKeyAsync, createPublicKey } as NativeSentryKeyFactory
        );
      });
      return shake;
    }
    classical ??= ensureNativeCryptoReady().then(async () => {
      const { deriveSentryClassicalPublicKey } = await import(
        '@sidhujag/sysweb3-sentry/classical-public-key'
      );
      return createSentryClassicalExecutor(deriveSentryClassicalPublicKey);
    });
    return classical;
  });
}
