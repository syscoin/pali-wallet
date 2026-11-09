import {
  projectDappPermissions,
  readDappPermissionRequest,
} from './dappPermissions';

it('projects only the supplied persisted authority without duplicating chains', () => {
  expect(
    projectDappPermissions('https://app.example', '0xabc', 123, [1, 1])
  ).toEqual([
    {
      id: '1',
      parentCapability: 'eth_accounts',
      invoker: 'https://app.example',
      date: 123,
      caveats: [{ type: 'restrictReturnedAccounts', value: ['0xabc'] }],
    },
    {
      id: '2',
      parentCapability: 'endowment:permitted-chains',
      invoker: 'https://app.example',
      date: 123,
      caveats: [{ type: 'restrictNetworkSwitching', value: ['0x1'] }],
    },
  ]);
  expect(
    projectDappPermissions('origin', 'address', 1, undefined)
  ).toHaveLength(1);
});
it('allows the extension connected shortcut only for the existing account permission', () => {
  expect(
    readDappPermissionRequest('wallet_requestPermissions', [
      { ['eth_accounts']: {} },
    ])
  ).toEqual({ ['eth_accounts']: {} });
  for (const value of [
    {},
    { unknown: {} },
    { ['eth_accounts']: { caveats: [] } },
    { ['eth_accounts']: {}, other: {} },
  ])
    expect(() =>
      readDappPermissionRequest('wallet_requestPermissions', [value])
    ).toThrow();
});
it('keeps empty revocation a no-op and accepts a nonempty revocation without expanding it', () => {
  expect(
    readDappPermissionRequest('wallet_revokePermissions', undefined)
  ).toEqual({});
  expect(readDappPermissionRequest('wallet_revokePermissions', [{}])).toEqual(
    {}
  );
  expect(
    readDappPermissionRequest('wallet_revokePermissions', [
      { ['eth_accounts']: {} },
    ])
  ).toEqual({ ['eth_accounts']: {} });
  expect(() =>
    readDappPermissionRequest('wallet_getPermissions', [{}])
  ).toThrow();
  expect(() =>
    readDappPermissionRequest('wallet_revokePermissions', [null])
  ).toThrow();
});
