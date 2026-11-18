import { id } from 'ethers';

import { PRIVACY_POOLS } from '../utils/privacy/registry';

import { getPrivacyPoolActivity } from './privacyPoolActivity';

const deposit = id('deposit(bytes32)').slice(0, 10);
const withdraw = id(
  'withdraw(bytes,bytes32,bytes32,address,address,uint256,uint256)'
).slice(0, 10);

it.each(PRIVACY_POOLS)(
  'identifies direct deposit and withdrawal calls for the $amount ETH pool',
  ({ address, amount }) => {
    expect(
      getPrivacyPoolActivity(1, address, deposit + 'ab'.repeat(32))
    ).toEqual({
      kind: 'deposit',
      amount,
    });
    expect(getPrivacyPoolActivity('1', address, withdraw)).toEqual({
      kind: 'withdrawal',
      amount,
    });
  }
);

it('requires a known Ethereum pool address and a privacy method', () => {
  const [{ address }] = PRIVACY_POOLS;
  expect(getPrivacyPoolActivity(11155111, address, deposit)).toBeUndefined();
  expect(
    getPrivacyPoolActivity(1, '0x' + '11'.repeat(20), withdraw)
  ).toBeUndefined();
  expect(getPrivacyPoolActivity(1, address, '0x')).toBeUndefined();
  expect(
    getPrivacyPoolActivity(1, address, id('deposit()').slice(0, 10))
  ).toBeUndefined();
});
