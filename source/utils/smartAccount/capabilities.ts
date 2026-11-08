import { getPaliModuleAddress, PALI_MODULE_REGISTRY } from './contracts.ts';

declare const TARGET_BROWSER: string | undefined;

export const isSLHDSAOffscreenSignerSupported = () =>
  typeof TARGET_BROWSER === 'undefined' || TARGET_BROWSER === 'chrome';

export const getAvailablePaliModules = (chainId: number) =>
  PALI_MODULE_REGISTRY.map((entry) => {
    const address = getPaliModuleAddress(chainId, entry.id);
    const supported =
      Boolean(address) &&
      (entry.id !== 'slh-dsa' || isSLHDSAOffscreenSignerSupported());
    return {
      ...(entry.capability ? { capability: entry.capability } : {}),
      displayName: entry.displayName,
      id: entry.id,
      kind: entry.kind,
      moduleType: entry.moduleType,
      supported,
    };
  });
