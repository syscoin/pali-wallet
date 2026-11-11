import type { NativeHdKeyExportRuntime } from '../../src/custody/hdKeyExport.ts';
import { bindNativePrivateAuthentication, type NativePrivateAuthentication } from '../../src/custody/privateAuthentication.ts';

const facades = new WeakMap<NativeHdKeyExportRuntime<NativePrivateAuthentication>, NativeHdKeyExportRuntime>();
/** Same public-scope/private-binding seam as nativeFactory, without an OS prompt. */
export function testHdKeyExportRuntime(port: NativeHdKeyExportRuntime<NativePrivateAuthentication>): NativeHdKeyExportRuntime {
  let facade = facades.get(port);
  if (!facade) {
    facade = Object.freeze<NativeHdKeyExportRuntime>({
      isAuthenticationRefusal: port.isAuthenticationRefusal,
      readSelected: (scope, signal, check, authentication) => port.readSelected(scope, signal, check,
        bindNativePrivateAuthentication(authentication, { assertCurrent: check, isPromptActive: () => false })),
    });
    facades.set(port, facade);
  }
  return facade;
}
