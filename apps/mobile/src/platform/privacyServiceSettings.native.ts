import { createPrivacyServiceSettings } from '../../../../source/shared/privacyServiceOrigin.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import type { KeyringStoragePort } from '../storage/types.ts';

/** Native persistence adapter; origin validation and source revision policy stay shared. */
export function createNativePrivacyServiceSettings(storage: Pick<KeyringStoragePort, 'get' | 'compareAndSetMany'>) {
  if (typeof storage?.get !== 'function' || typeof storage.compareAndSetMany !== 'function') throw Error('privacy_service_storage_unavailable');
  const read = storage.get.bind(storage), commit = storage.compareAndSetMany.bind(storage);
  let writing: (() => void) | undefined;
  const settings = createPrivacyServiceSettings({
    read: key => read(key),
    async write(key, origin) {
      const guard = writing;
      if (!guard) throw Error('privacy_service_changed');
      assertSynchronousEvmFeeGuard(guard);
      const previous = await read(key);
      assertSynchronousEvmFeeGuard(guard);
      if (!await commit([{ key, expected: previous, value: origin }], guard))
        throw Error('privacy_service_changed');
      assertSynchronousEvmFeeGuard(guard);
    },
  });
  return Object.freeze({
    ...settings,
    async changeOrigin(value: string, invalidate: () => Promise<void>, expectedOrigin: string, assertCurrent: () => void) {
      if (writing) throw Error('privacy_service_changed');
      assertSynchronousEvmFeeGuard(assertCurrent);
      const guard = () => assertSynchronousEvmFeeGuard(assertCurrent);
      writing = guard;
      try { return await settings.changeOrigin(value, async () => { guard(); await invalidate(); guard(); }, expectedOrigin); }
      finally { if (writing === guard) writing = undefined; }
    },
  });
}
