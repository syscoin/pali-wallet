import { assertSynchronousEvmFeeGuard } from '../../shared/evmFeeGuard.ts';
import { getAddress, AddressZero } from '../ethersV6Compat.ts';

import {
  encodeEcdsaValidatorInitData,
  encodeCompositeValidatorInitData,
  getConfiguredAuthenticatorAddress,
} from './account.ts';
import { requireSmartAccountAddressIdentity } from './addressIdentity.ts';
import {
  aggregateContractCalls,
  type AggregateCallRequest,
  type AggregateCallResult,
} from './aggregate.ts';
import {
  buildHydratedP256WebAuthnAuthenticator,
  buildHydratedSLHDSAAuthenticator,
} from './authenticators.ts';
import { getAvailablePaliModules } from './capabilities.ts';
import {
  ERC7579_MODULE_TYPE_VALIDATOR,
  paliSmartAccountInterface,
  paliP256WebAuthnValidatorInterface,
  paliEcdsaValidatorInterface,
  paliCompositeValidatorInterface,
  paliSlhDsaValidatorInterface,
} from './contracts.ts';
import type { ISmartAccountMetadata } from '../../types/network.ts';

export function hasUsableSmartAccountAuthMetadata(
  metadata: ISmartAccountMetadata
): boolean {
  const auth = metadata.auth;
  return (
    !!auth?.validator &&
    !!metadata.installedModules?.some(
      (module) =>
        module.type === 'validator' &&
        module.address.toLowerCase() === auth.validator.toLowerCase()
    )
  );
}

function requireAggregateResult(
  result: AggregateCallResult | undefined,
  label: string
): NonNullable<AggregateCallResult['result']> {
  if (!result?.success)
    throw new Error(`Failed to read smart account state (${label})`);
  return result.result;
}

/** Shared validator observation. Hosts retain their cache, guardian and persistence boundaries. */
export async function readSmartAccountValidatorMetadata({
  account,
  chainId,
  provider,
  assertCurrent,
}: {
  account: {
    address: string;
    smartAccount: ISmartAccountMetadata;
    xpub: string;
  };
  assertCurrent(): void;
  chainId: number;
  provider: Parameters<typeof aggregateContractCalls>[0];
}): Promise<ISmartAccountMetadata> {
  assertSynchronousEvmFeeGuard(assertCurrent);
  requireSmartAccountAddressIdentity(account, chainId);
  const metadata = account.smartAccount;

  const p256Address = getConfiguredAuthenticatorAddress(
    chainId,
    'p256-webauthn'
  );
  const ecdsaAddress = getConfiguredAuthenticatorAddress(chainId, 'ecdsa');
  const compositeAddress = getConfiguredAuthenticatorAddress(
    chainId,
    'composite'
  );
  const slhDsaAddress = getConfiguredAuthenticatorAddress(chainId, 'slh-dsa');
  const includeSlhDsa = Boolean(slhDsaAddress);
  const isModuleInstalledCall = (
    moduleAddress: string,
    moduleType: number = ERC7579_MODULE_TYPE_VALIDATOR
  ): AggregateCallRequest => ({
    args: [moduleType, moduleAddress, '0x'],
    fn: 'isModuleInstalled',
    iface: paliSmartAccountInterface,
    target: account.address,
  });

  // Bring-your-own modules: hydration only knows builtin addresses, so the
  // durable custom records tell us which extra addresses to probe.
  // v1 scope is custom validators only (moduleType 1).
  const customRecords = (metadata.customModules || []).filter(
    (record) => record.moduleType === ERC7579_MODULE_TYPE_VALIDATOR
  );

  const calls: AggregateCallRequest[] = [
    isModuleInstalledCall(p256Address),
    {
      args: [account.address],
      fn: 'authData',
      iface: paliP256WebAuthnValidatorInterface,
      target: p256Address,
    },
    isModuleInstalledCall(ecdsaAddress),
    {
      args: [account.address],
      fn: 'owners',
      iface: paliEcdsaValidatorInterface,
      target: ecdsaAddress,
    },
    {
      args: [account.address],
      fn: 'threshold',
      iface: paliEcdsaValidatorInterface,
      target: ecdsaAddress,
    },
    isModuleInstalledCall(compositeAddress),
    {
      args: [account.address],
      fn: 'childValidators',
      iface: paliCompositeValidatorInterface,
      target: compositeAddress,
    },
    {
      args: [account.address],
      fn: 'threshold',
      iface: paliCompositeValidatorInterface,
      target: compositeAddress,
    },
    ...(includeSlhDsa
      ? ([
          isModuleInstalledCall(slhDsaAddress),
          {
            args: [account.address],
            fn: 'authData',
            iface: paliSlhDsaValidatorInterface,
            target: slhDsaAddress,
          },
        ] as AggregateCallRequest[])
      : []),
    {
      args: [],
      fn: 'activeValidator',
      iface: paliSmartAccountInterface,
      target: account.address,
    },
    ...customRecords.map((record) =>
      isModuleInstalledCall(record.address, record.moduleType)
    ),
  ];

  const [code, results] = await Promise.all([
    provider.getCode(account.address),
    aggregateContractCalls(provider, chainId, calls),
  ]);
  assertSynchronousEvmFeeGuard(assertCurrent);
  if (typeof code !== 'string' || !/^0x(?:[a-f\d]{2})*$/i.test(code))
    throw new Error('Invalid smart account code');
  if (code === '0x') {
    return {
      ...metadata,
      availableModules: getAvailablePaliModules(metadata.chainId),
      isDeployed: false,
      installedModules: metadata.installedModules || [],
    };
  }

  const installedModules: NonNullable<
    ISmartAccountMetadata['installedModules']
  > = [];

  const [p256Installed] = requireAggregateResult(
    results[0],
    'p256 isModuleInstalled'
  );
  if (p256Installed) {
    const [authData] = requireAggregateResult(
      results[1],
      'p256 authData'
    ) as unknown as [any];
    const publicKey = {
      originHash: authData.originHash || authData[3],
      originLength: Number(authData.originLength || authData[4] || 0),
      rpIdHash: authData.rpIdHash || authData[2],
      x: authData.publicKeyX || authData[0],
      y: authData.publicKeyY || authData[1],
    };
    const built = buildHydratedP256WebAuthnAuthenticator({
      chainId,
      publicKey,
    });
    installedModules.push(...(built.metadata.installedModules || []));
  }

  const [ecdsaInstalled] = requireAggregateResult(
    results[2],
    'ecdsa isModuleInstalled'
  );
  if (ecdsaInstalled) {
    const [rawOwners] = requireAggregateResult(
      results[3],
      'ecdsa owners'
    ) as unknown as [string[]];
    const owners = rawOwners.map((owner: string) => getAddress(owner));
    const threshold = Number(
      requireAggregateResult(results[4], 'ecdsa threshold')[0]
    );
    installedModules.push({
      address: getAddress(ecdsaAddress),
      config: { owners, threshold },
      data: encodeEcdsaValidatorInitData(owners, threshold),
      id: 'ecdsa',
      type: 'validator',
    });
  }

  const [compositeInstalled] = requireAggregateResult(
    results[5],
    'composite isModuleInstalled'
  );
  if (compositeInstalled) {
    const [rawChildren] = requireAggregateResult(
      results[6],
      'composite childValidators'
    ) as unknown as [string[]];
    const childValidators = rawChildren.map((child: string) =>
      getAddress(child)
    );
    const threshold = Number(
      requireAggregateResult(results[7], 'composite threshold')[0]
    );
    installedModules.push({
      address: getAddress(compositeAddress),
      config: { childValidators, threshold },
      data: encodeCompositeValidatorInitData(childValidators, threshold),
      id: 'composite',
      type: 'validator',
    });
  }

  const activeValidatorResultIndex = 8 + (includeSlhDsa ? 2 : 0);

  if (includeSlhDsa) {
    const slhDsaInstalled =
      results[8]?.success && Boolean(results[8].result[0]);
    if (slhDsaInstalled) {
      const [authData] = requireAggregateResult(
        results[9],
        'slh-dsa authData'
      ) as unknown as [any];
      const pkSeed = authData.pkSeed || authData[0];
      const pkRoot = authData.pkRoot || authData[1];
      const built = buildHydratedSLHDSAAuthenticator({
        chainId,
        pkRoot,
        pkSeed,
      });
      installedModules.push(...(built.metadata.installedModules || []));
    }
  }

  // Custom (bring-your-own) modules still installed on-chain. Failed
  // probes (e.g. module self-destructed) simply drop the module from the
  // installed list; the durable record remains for later re-probing.
  const customBaseIndex = activeValidatorResultIndex + 1;
  const installedValidatorAddresses = new Set(
    installedModules.map((module) => module.address.toLowerCase())
  );
  customRecords.forEach((record, index) => {
    const probe = results[customBaseIndex + index];
    const installed = probe?.success && Boolean(probe.result[0]);
    if (installed) {
      const address = getAddress(record.address);
      if (installedValidatorAddresses.has(address.toLowerCase())) return;
      // A builtin already read from its canonical contract is authoritative;
      // a durable custom-install record must not shadow or duplicate it.
      installedValidatorAddresses.add(address.toLowerCase());
      installedModules.push({
        address,
        config: {
          compositeCompatible: record.compositeCompatible,
          initData: record.initData,
          moduleType: record.moduleType,
          name: record.name,
        },
        data: record.initData,
        id: 'custom',
        type: 'validator',
      });
    }
  });

  const activeValidatorAddress = getAddress(
    requireAggregateResult(
      results[activeValidatorResultIndex],
      'activeValidator'
    )[0] as string
  );
  const activeValidator =
    activeValidatorAddress !== AddressZero
      ? installedModules.find(
          (module) =>
            module.type === 'validator' &&
            module.address.toLowerCase() ===
              activeValidatorAddress.toLowerCase()
        )
      : null;
  const hydrated: ISmartAccountMetadata = {
    ...metadata,
    auth:
      activeValidator?.type === 'validator'
        ? {
            data: activeValidator.data || '0x',
            module: activeValidator.id,
            validator: activeValidator.address,
          }
        : undefined,
    availableModules: getAvailablePaliModules(chainId),
    isDeployed: true,
    installedModules,
  };
  return hydrated;
}
