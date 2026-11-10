import { initialActiveHdAccountState } from '../types/network';

import {
  getSmartAccountModulesProjection,
  SmartAccountModulesProjectionError,
} from './smartAccountModules';
import type { IKeyringAccountState } from '../types/network';

const address = '0x1111111111111111111111111111111111111111';
const validator = '0x2222222222222222222222222222222222222222';
const custom = '0x3333333333333333333333333333333333333333';
const slh = '0x4444444444444444444444444444444444444444';
const guardian = '0x5555555555555555555555555555555555555555';
const account = (): IKeyringAccountState => ({
  ...initialActiveHdAccountState,
  address,
  isSmartAccount: true,
  xprv: 'private-owner-key',
  xpub: 'local-identity',
  smartAccount: {
    auth: { module: 'ecdsa', validator, data: '0x1234' },
    chainId: 5700,
    contractVersion: 'private-contract-version',
    deploymentSalt: 'private-deployment-salt',
    descriptor: {
      accountIndex: 12,
      accountVersion: 'local-account-version',
      anchor: 'private-anchor',
      anchorHash: 'private-anchor-hash',
      chainId: 5700,
      deploymentSalt: 'private-descriptor-salt',
      factoryAddress: address,
    },
    customModules: [
      {
        address: custom,
        name: 'Durable name',
        moduleType: 1,
        initData: '0xcafe',
      },
    ],
    isDeployed: true,
    installedModules: [
      {
        address: validator,
        id: 'ecdsa',
        type: 'validator',
        data: '0x1234',
        config: { owners: [address], threshold: 1 },
      },
      {
        address: custom,
        id: 'custom',
        type: 'validator',
        data: '0xabcd',
        config: {
          name: 'Installed custom name',
          moduleType: 1,
          initData: '0xabcd',
          compositeCompatible: true,
        },
      },
      {
        address: slh,
        id: 'slh-dsa',
        type: 'validator',
        data: '0x5678',
        config: {
          keyId: 'private-key-id',
          parameterSet: 'SLH-DSA-SHA2-128-24',
          pkSeed: 'private-pk-seed',
          pkRoot: 'private-pk-root',
          signatureLimit: 100,
        },
      },
      {
        address: guardian,
        id: 'guardian-recovery',
        type: 'executor',
        data: '0x9012',
        config: { guardians: [address], delaySeconds: 123, threshold: 1 },
      },
    ],
  },
});

it('projects only the extension inventory DTO, without private configuration or account metadata', () => {
  const value = account();
  const projection = getSmartAccountModulesProjection(value, 5700);
  expect(projection).toEqual({
    address,
    chainId: '0x1644',
    deployed: true,
    installed: [
      { address: validator, id: 'ecdsa', moduleType: 1, name: undefined },
      {
        address: custom,
        id: 'custom',
        moduleType: 1,
        name: 'Installed custom name',
      },
      { address: slh, id: 'slh-dsa', moduleType: 1, name: undefined },
      {
        address: guardian,
        id: 'guardian-recovery',
        moduleType: 2,
        name: undefined,
      },
    ],
    activeValidator: validator,
  });
  expect(JSON.stringify(projection)).not.toMatch(
    /private-|local-|0xabcd|0x1234|0x5678|0x9012|Durable name/
  );
  projection.installed[0]!.address = custom;
  expect(value.smartAccount!.installedModules![0]!.address).toBe(validator);
});

it('does not read descriptor, keys, validator data or unexposed configuration fields', () => {
  const value = account(),
    metadata = value.smartAccount!;
  const hidden = {
    get: () => {
      throw new Error('Private field read');
    },
  };
  Object.defineProperty(value, 'xprv', hidden);
  Object.defineProperty(value, 'xpub', hidden);
  Object.defineProperty(metadata, 'descriptor', hidden);
  Object.defineProperty(metadata, 'deploymentAuth', hidden);
  Object.defineProperty(metadata.auth!, 'data', hidden);
  for (const module of metadata.installedModules!) {
    Object.defineProperty(module, 'data', hidden);
    for (const key of [
      'owners',
      'threshold',
      'initData',
      'keyId',
      'pkSeed',
      'pkRoot',
    ])
      Object.defineProperty(module.config, key, hidden);
  }
  expect(getSmartAccountModulesProjection(value, 5700).installed).toHaveLength(
    4
  );
});

it('retains undefined names on the DTO and omits them during JSON serialization', () => {
  const value = account();
  const customModule = value.smartAccount!.installedModules![1]!;
  if (customModule.id !== 'custom') throw new Error('Invalid fixture');
  delete (customModule.config as { name?: string }).name;
  const projection = getSmartAccountModulesProjection(value, 5700);
  for (const module of projection.installed) {
    expect(Object.hasOwn(module, 'name')).toBe(true);
    expect(module.name).toBeUndefined();
  }
  for (const module of JSON.parse(JSON.stringify(projection)).installed)
    expect(Object.hasOwn(module, 'name')).toBe(false);
});

it('keeps undeployed and absent cached module/auth state explicit', () => {
  const value = account();
  value.smartAccount!.isDeployed = false;
  value.smartAccount!.installedModules = undefined;
  value.smartAccount!.auth = undefined;
  expect(getSmartAccountModulesProjection(value, 5700)).toEqual({
    address,
    chainId: '0x1644',
    deployed: false,
    installed: [],
    activeValidator: null,
  });
});

it.each([undefined, { address }, { address, isSmartAccount: true }])(
  'retains the connected EOA/missing-metadata error for %p',
  (value) => {
    expect(() =>
      getSmartAccountModulesProjection(value as IKeyringAccountState, 5700)
    ).toThrow('The connected account is not a smart account');
    try {
      getSmartAccountModulesProjection(value as IKeyringAccountState, 5700);
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_SMART_ACCOUNT' });
    }
  }
);

it('retains the exact wrong-chain message', () => {
  expect(() => getSmartAccountModulesProjection(account(), 1)).toThrow(
    'Smart account modules are only available on chain 5700. Switch back from chain 1 to inspect this account.'
  );
  try {
    getSmartAccountModulesProjection(account(), 1);
  } catch (error) {
    expect(error).toBeInstanceOf(SmartAccountModulesProjectionError);
    expect(error).toMatchObject({ code: 'WRONG_CHAIN' });
  }
});

it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '5700'])(
  'refuses invalid trusted chain identifiers: %p',
  (chainId) => {
    expect(() =>
      getSmartAccountModulesProjection(account(), chainId as number)
    ).toThrow('Smart account modules require valid numeric chain identifiers');
    const value = account();
    value.smartAccount!.chainId = chainId as number;
    expect(() => getSmartAccountModulesProjection(value, 5700)).toThrow(
      'Smart account modules require valid numeric chain identifiers'
    );
  }
);
