import { encodeP256WebAuthnAuthData } from 'utils/passkey/account';

import {
  encodeCompositeValidatorInitData,
  encodeEcdsaValidatorInitData,
  encodeGuardianRecoveryInitData,
} from './account';
import {
  getPaliModuleAddress,
  PaliAuthenticatorModuleId,
  PALI_MODULE_REGISTRY,
} from './contracts';

export type PaliSmartAccountTemplateId =
  | 'comanaged-passkey-ecdsa'
  | 'guardian-recovery'
  | 'passkey-default';

export type PaliModuleInstallTemplate = {
  description: string;
  displayName: string;
  id: PaliSmartAccountTemplateId;
  modules: Array<{
    initData: string;
    module: PaliAuthenticatorModuleId;
    moduleAddress: string;
  }>;
};

export const isSLHDSAOffscreenSignerSupported = () =>
  typeof TARGET_BROWSER === 'undefined' || TARGET_BROWSER === 'chrome';

export const getAvailablePaliModules = (chainId: number) =>
  PALI_MODULE_REGISTRY.map((entry) => {
    const address = getPaliModuleAddress(chainId, entry.id);
    const supported =
      Boolean(address) &&
      (entry.id !== 'slh-dsa' || isSLHDSAOffscreenSignerSupported());
    return {
      capability: entry.capability,
      displayName: entry.displayName,
      id: entry.id,
      kind: entry.kind,
      moduleType: entry.moduleType,
      supported,
    };
  });

export const createPasskeyDefaultTemplate = (params: {
  chainId: number;
  credentialIdHash: string;
  originHash: string;
  originLength: number;
  rpIdHash: string;
  x: string;
  y: string;
}): PaliModuleInstallTemplate => ({
  description: 'Passkey signs everyday actions on chains with P-256 support.',
  displayName: 'Passkey',
  id: 'passkey-default',
  modules: [
    {
      initData: encodeP256WebAuthnAuthData(params),
      module: 'p256-webauthn',
      moduleAddress: getPaliModuleAddress(params.chainId, 'p256-webauthn'),
    },
  ],
});

export const createComanagedPasskeyEcdsaTemplate = (params: {
  chainId: number;
  credentialIdHash: string;
  ecdsaOwner: string;
  originHash: string;
  originLength: number;
  rpIdHash: string;
  x: string;
  y: string;
}): PaliModuleInstallTemplate => {
  const p256 = getPaliModuleAddress(params.chainId, 'p256-webauthn');
  const ecdsa = getPaliModuleAddress(params.chainId, 'ecdsa');
  const composite = getPaliModuleAddress(params.chainId, 'composite');

  return {
    description: 'Passkey or ECDSA can authorize actions.',
    displayName: 'Co-managed',
    id: 'comanaged-passkey-ecdsa',
    modules: [
      {
        initData: encodeP256WebAuthnAuthData(params),
        module: 'p256-webauthn',
        moduleAddress: p256,
      },
      {
        initData: encodeEcdsaValidatorInitData([params.ecdsaOwner], 1),
        module: 'ecdsa',
        moduleAddress: ecdsa,
      },
      {
        initData: encodeCompositeValidatorInitData([p256, ecdsa], 1),
        module: 'composite',
        moduleAddress: composite,
      },
    ],
  };
};

export const createGuardianRecoveryTemplate = (params: {
  chainId: number;
  delaySeconds: number;
  expirationSeconds: number;
  guardians: string[];
  threshold: number;
}): PaliModuleInstallTemplate => ({
  description: 'Guardians can recover the account after a timelock.',
  displayName: 'Guardian recovery',
  id: 'guardian-recovery',
  modules: [
    {
      initData: encodeGuardianRecoveryInitData(params),
      module: 'guardian-recovery',
      moduleAddress: getPaliModuleAddress(params.chainId, 'guardian-recovery'),
    },
  ],
});
