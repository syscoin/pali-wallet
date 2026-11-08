import { INetworkType, KeyringAccountType } from '../types/network';

import { MAX_DAPP_ORIGIN_LENGTH, readStoredDappPermissions } from './dappTypes';

const origin = 'https://approved.example';
const grant = {
  host: origin,
  accountId: 0,
  accountType: KeyringAccountType.HDAccount,
  chain: INetworkType.Ethereum,
  chainId: 1,
  date: 1,
};

it('reads committed released grants without a pending marker field', () => {
  expect(readStoredDappPermissions({ dapps: { [origin]: grant } })).toEqual({
    dapps: { [origin]: grant },
    pendingOrigins: [],
  });
});

it('suppresses pending grants while retaining their marker across another save', () => {
  const cold = readStoredDappPermissions({
    dapps: { [origin]: grant },
    pendingOrigins: [origin],
  });
  expect(cold).toEqual({ dapps: {}, pendingOrigins: [origin] });
  expect(readStoredDappPermissions(cold)).toEqual(cold);
});

it.each([
  null,
  'invalid',
  [origin, origin],
  ['approved.example'],
  ['https://approved.example/path'],
  [17],
  ['https://' + 'a'.repeat(MAX_DAPP_ORIGIN_LENGTH) + '.example'],
])('rejects a malformed present pending-origin field %j', (pendingOrigins) => {
  expect(() =>
    readStoredDappPermissions({ dapps: { [origin]: grant }, pendingOrigins })
  ).toThrow('Invalid pending dapp permissions');
});
