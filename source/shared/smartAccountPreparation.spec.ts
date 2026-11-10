import { getAddress } from '../utils/ethersV6Compat';

import {
  getRequestedSmartAccountAuthenticator,
  projectSmartAccountPreparationResult,
  resolveSmartAccountPreparationTarget,
  SmartAccountPreparationError,
} from './smartAccountPreparation';

const owner = '0x1111111111111111111111111111111111111111';
const otherOwner = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const resolve = (
  selected: Parameters<typeof resolveSmartAccountPreparationTarget>[0],
  slhDsaSupported = true
) => resolveSmartAccountPreparationTarget(selected, { slhDsaSupported });

it('selects the existing truthy authenticator precedence and P256 default without validating for presentation', () => {
  const first = { id: 'future-validator' },
    second = { id: 'ecdsa' },
    third = { id: 'slh-dsa' };
  expect(
    getRequestedSmartAccountAuthenticator({
      authenticator: first,
      initialAuthenticator: second,
      policy: { authenticator: third },
    })
  ).toBe(first);
  expect(
    getRequestedSmartAccountAuthenticator({
      initialAuthenticator: second,
      policy: { authenticator: third },
    })
  ).toBe(second);
  expect(
    getRequestedSmartAccountAuthenticator({ policy: { authenticator: third } })
  ).toBe(third);
  expect(getRequestedSmartAccountAuthenticator({})).toEqual({
    id: 'p256-webauthn',
  });
  expect(
    getRequestedSmartAccountAuthenticator({
      authenticator: null as never,
      initialAuthenticator: second,
    })
  ).toBe(second);
  const empty = {};
  expect(
    getRequestedSmartAccountAuthenticator({
      authenticator: empty,
      initialAuthenticator: second,
    })
  ).toBe(empty);
  expect(() => resolve(first)).toThrow('PREPARE_FAILED');
});

it('keeps default ECDSA separate from an explicit owner/threshold target', () => {
  expect(resolve({ id: 'ecdsa' })).toEqual({ id: 'ecdsa', config: undefined });
  const config = { owners: [otherOwner, owner] };
  const target = resolve({ id: 'ecdsa', config });
  expect(target).toEqual({
    id: 'ecdsa',
    config: { owners: [getAddress(otherOwner), owner], threshold: 1 },
  });
  if (target.id !== 'ecdsa' || !target.config)
    throw new Error('Invalid fixture target');
  expect(Object.isFrozen(target)).toBe(true);
  expect(Object.isFrozen(target.config)).toBe(true);
  expect(Object.isFrozen(target.config.owners)).toBe(true);
  config.owners.reverse();
  expect(target.config.owners).toEqual([getAddress(otherOwner), owner]);
  expect(
    resolve({
      id: 'ecdsa',
      config: { owners: [owner, otherOwner], threshold: 2 },
    })
  ).toEqual({
    id: 'ecdsa',
    config: { owners: [owner, getAddress(otherOwner)], threshold: 2 },
  });
});

it.each([
  null,
  {},
  [],
  { owners: [] },
  { owners: 'invalid' },
  { owners: null },
])('does not default an explicitly malformed ECDSA config: %p', (config) => {
  expect(() => resolve({ id: 'ecdsa', config })).toThrow('PREPARE_FAILED');
});

it.each([0, -1, 2, 1.5, '1', null, true])(
  'retains ECDSA threshold validation: %p',
  (threshold) => {
    expect(() =>
      resolve({ id: 'ecdsa', config: { owners: [owner], threshold } })
    ).toThrow('PREPARE_FAILED');
  }
);

it('rejects normalized duplicate owners and preserves address validation before acquisition', () => {
  expect(() =>
    resolve({
      id: 'ecdsa',
      config: { owners: [otherOwner, getAddress(otherOwner)], threshold: 2 },
    })
  ).toThrow('PREPARE_FAILED');
  expect(() =>
    resolve({ id: 'ecdsa', config: { owners: ['invalid-address'] } })
  ).toThrow();
});

it.each([undefined, null])(
  'permits only wallet-acquired P256 credentials (config %p)',
  (config) => {
    expect(resolve({ id: 'p256-webauthn', config })).toEqual({
      id: 'p256-webauthn',
    });
  }
);

it.each([
  {},
  false,
  '',
  0,
  {
    credentialIdHash: 'remote-id',
    publicKey: { x: 'remote-x', y: 'remote-y' },
  },
])('refuses every non-null supplied P256 config: %p', (config) => {
  expect(() => resolve({ id: 'p256-webauthn', config })).toThrow(
    'EXTERNAL_PASSKEY_UNSUPPORTED'
  );
});

it.each([undefined, null, false, 0, ''])(
  'retains wallet-owned SLH provisioning admission for absent/falsy config: %p',
  (config) => {
    expect(resolve({ id: 'slh-dsa', config })).toEqual({ id: 'slh-dsa' });
    expect(() => resolve({ id: 'slh-dsa', config }, false)).toThrow(
      'PREPARE_FAILED'
    );
  }
);

it.each([
  {},
  [],
  { keyId: 'remote-key', pkSeed: 'remote-seed', pkRoot: 'remote-root' },
])('rejects caller-provided SLH signer configuration: %p', (config) => {
  expect(() => resolve({ id: 'slh-dsa', config })).toThrow('PREPARE_FAILED');
});

it('retains the distinct composite unsupported error and generic unknown/missing-id error', () => {
  expect(() => resolve({ id: 'composite' })).toThrow('COMPOSITE_UNSUPPORTED');
  for (const selected of [{}, { id: 'custom' }, { id: 'future-validator' }])
    expect(() => resolve(selected)).toThrow(SmartAccountPreparationError);
});

it('projects only the exact lazy-bootstrap or adopted-validator public result', () => {
  const lazy = projectSmartAccountPreparationResult(owner, 5700);
  expect(lazy).toEqual({ address: owner, chainId: '0x1644' });
  expect(Object.hasOwn(lazy, 'installedValidator')).toBe(false);
  const adopted = projectSmartAccountPreparationResult(owner, 5700, otherOwner);
  expect(adopted).toEqual({
    address: owner,
    chainId: '0x1644',
    installedValidator: otherOwner,
  });
  expect(Object.keys(adopted)).toEqual([
    'address',
    'chainId',
    'installedValidator',
  ]);
});
