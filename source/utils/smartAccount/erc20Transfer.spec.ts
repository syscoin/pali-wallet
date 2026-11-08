import { Interface } from 'ethers/abi';
import { buildSmartAccountErc20Transfer } from './erc20Transfer';

const token = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';
const abi = new Interface(['function transfer(address,uint256)']);

test.each(['1', '9', ((BigInt(1) << BigInt(256)) - BigInt(1)).toString()])(
  'encodes exact shared ERC20 units %s',
  (units) => {
    expect(buildSmartAccountErc20Transfer(token, recipient, units)).toEqual({
      target: token,
      value: '0x0',
      data: abi.encodeFunctionData('transfer', [recipient, units]),
    });
  }
);
test.each(['0', '-1', '1e18', (BigInt(1) << BigInt(256)).toString()])(
  'rejects invalid ERC20 quantity %s',
  (units) => {
    expect(() =>
      buildSmartAccountErc20Transfer(token, recipient, units)
    ).toThrow();
  }
);
test('validates both contract and recipient before returning an execution', () => {
  expect(() =>
    buildSmartAccountErc20Transfer('token.eth', recipient, '1')
  ).toThrow();
  expect(() =>
    buildSmartAccountErc20Transfer(token, '0x' + '00'.repeat(20), '1')
  ).toThrow();
});
