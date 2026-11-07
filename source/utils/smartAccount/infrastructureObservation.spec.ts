import {
  PALI_CREATE2_DEPLOYER_ADDRESS,
  PALI_INFRASTRUCTURE_METADATA,
} from './deploymentMetadata';
import {
  projectSmartAccountInfrastructureObservation,
  SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES,
} from './infrastructureObservation';

it('uses the canonical code order and reports the deployer and optional contracts separately', () => {
  expect(SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES).toEqual([
    PALI_CREATE2_DEPLOYER_ADDRESS,
    ...PALI_INFRASTRUCTURE_METADATA.map(({ address }) => address),
  ]);
  const codes = [
    '0x',
    ...PALI_INFRASTRUCTURE_METADATA.map(({ optional }) =>
      optional ? '0x' : '0xAAbb'
    ),
  ];
  expect(
    projectSmartAccountInfrastructureObservation(11155111, codes)
  ).toMatchObject({
    chainId: 11155111,
    create2Deployer: {
      address: PALI_CREATE2_DEPLOYER_ADDRESS,
      deployed: false,
    },
    missing: ['multicall3'],
    ready: true,
  });

  const factoryIndex = PALI_INFRASTRUCTURE_METADATA.findIndex(
    ({ id }) => id === 'factory'
  );
  codes[0] = '0x00';
  codes[factoryIndex + 1] = '0x';
  expect(
    projectSmartAccountInfrastructureObservation(11155111, codes)
  ).toMatchObject({
    create2Deployer: { deployed: true },
    missing: ['factory', 'multicall3'],
    ready: false,
  });
});

it('rejects missing or malformed code replies rather than reporting missing deployments', () => {
  const codes = SMART_ACCOUNT_INFRASTRUCTURE_CODE_ADDRESSES.map(() => '0x');
  expect(
    projectSmartAccountInfrastructureObservation(1, codes.slice(1))
  ).toBeUndefined();
  for (const reply of [null, '0x0', '0xzz']) {
    expect(
      projectSmartAccountInfrastructureObservation(1, [
        reply,
        ...codes.slice(1),
      ])
    ).toBeUndefined();
  }
  delete codes[0];
  expect(
    projectSmartAccountInfrastructureObservation(1, codes)
  ).toBeUndefined();
});
