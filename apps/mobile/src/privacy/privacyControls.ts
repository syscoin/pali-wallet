import type { createNativePrivacyServiceSettings } from '../platform/privacyServiceSettings.native.ts';
import { assertSynchronousEvmFeeGuard } from '../../../../source/shared/evmFeeGuard.ts';
import type { PrivacyPoolId } from '../../../../source/utils/privacy/types.ts';
import type { createNativePrivacyPoolSync } from './nativePrivacyPoolSync.ts';
export type NativePrivacyServiceSettingsPort = Pick<ReturnType<typeof createNativePrivacyServiceSettings>, 'getOrigin' | 'changeOrigin'>;

export type NativePrivacyControls = Readonly<{
  getOrigin(): Promise<string>;
  changeOrigin(value: string, expectedOrigin: string): Promise<string>;
  clearPublicData(): Promise<void>;
  openPool(poolId: PrivacyPoolId, signal: AbortSignal, assertCurrent: () => void): Promise<ReturnType<typeof createNativePrivacyPoolSync>>;
}>;
/** Settings and public reads only. This capability has no note/key storage port. */
export function createNativePrivacyControls(options: Readonly<{
  settings: NativePrivacyServiceSettingsPort;
  invalidate(): Promise<void>;
  openPool: NativePrivacyControls['openPool'];
  assertCurrent(): void;
  signal: AbortSignal;
}>): NativePrivacyControls {
  const check = () => {
    assertSynchronousEvmFeeGuard(options.assertCurrent);
    if (options.signal.aborted) throw Error('privacy_cancelled');
  };
  const invalidate = async () => { check(); await options.invalidate(); check(); };
  check();
  return Object.freeze({
    async getOrigin() { check(); const value = await options.settings.getOrigin(); check(); return value; },
    async changeOrigin(value, expectedOrigin) {
      check();
      const result = await options.settings.changeOrigin(value, invalidate, expectedOrigin, check);
      check(); return result;
    },
    clearPublicData: invalidate,
    async openPool(poolId, signal, assertCurrent) {
      check(); assertSynchronousEvmFeeGuard(assertCurrent);
      const pool = await options.openPool(poolId, signal, () => { check(); assertSynchronousEvmFeeGuard(assertCurrent); });
      try { check(); assertSynchronousEvmFeeGuard(assertCurrent); return pool; }
      catch (error) { await pool.dispose(); throw error; }
    },
  });
}
