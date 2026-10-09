import { buildSmartAccountUserOperation } from './account';
import { getSmartAccountUserOpHash } from './userOperationHash';

const CHAIN_ID = 57057;
const operation = buildSmartAccountUserOperation({
  accountGasLimits:
    '0x000000000000000000000000000249f00000000000000000000000000001d4c0',
  callData: '0xdeadbeef0102',
  gasFees: '0x0000000000000000000000003b9aca00000000000000000000000002540be400',
  initCode: '0x22222222222222222222222222222222222222221234',
  nonce: '18446744073709551617',
  preVerificationGas: '55000',
  sender: '0x1111111111111111111111111111111111111111',
});

describe('local EntryPoint v0.9 UserOperation hashes', () => {
  // These vectors came from getUserOpHash on the bundled EntryPoint creation
  // bytecode (keccak256 0x02025307db5c9d7eeccd47fb6367c13def38d851a60dc851df2089ab61d45068)
  // executed in Anvil at Pali's canonical EntryPoint address on chain 57057.
  // Upstream semantics: eth-infinitism/account-abstraction v0.9.0,
  // contracts/core/EntryPoint.sol and contracts/core/UserOperationLib.sol.
  it.each([
    [{}, '0x1a0dddd6c5cd562fb5692e50e66f40829620a0ae86bf81d22cf54afa0bb431e2'],
    [
      { initCode: '0x' },
      '0x13d830148343a10e185534fc2716347c6624d227531a67a783358399f99825a0',
    ],
    [
      { initCode: '0x', callData: '0x', nonce: '0' },
      '0x9cd60aa79715d47b58c6b11994279dcc0a14c8da54bd5f3b3c57e0c53809dc18',
    ],
  ])('matches the contract vector with %j', (change, expectedHash) => {
    expect(
      getSmartAccountUserOpHash({ ...operation, ...change }, CHAIN_ID)
    ).toBe(expectedHash);
  });

  it('excludes the signature from the owner signing intent', () => {
    expect(
      getSmartAccountUserOpHash(
        { ...operation, signature: '0x123456' },
        CHAIN_ID
      )
    ).toBe(getSmartAccountUserOpHash(operation, CHAIN_ID));
  });

  it.each([
    { sender: '0x3333333333333333333333333333333333333333' },
    { nonce: '18446744073709551618' },
    { initCode: '0x22222222222222222222222222222222222222225678' },
    { callData: '0xdeadbeef0103' },
    {
      accountGasLimits:
        '0x000000000000000000000000000249f00000000000000000000000000001d4c1',
    },
    { preVerificationGas: '55001' },
    {
      gasFees:
        '0x0000000000000000000000003b9aca00000000000000000000000002540be401',
    },
  ])('binds the structured operation field %j', (change) => {
    expect(
      getSmartAccountUserOpHash({ ...operation, ...change }, CHAIN_ID)
    ).not.toBe(getSmartAccountUserOpHash(operation, CHAIN_ID));
  });

  it('binds the intended chain', () => {
    expect(getSmartAccountUserOpHash(operation, CHAIN_ID + 1)).not.toBe(
      getSmartAccountUserOpHash(operation, CHAIN_ID)
    );
  });

  it.each([0, -1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid chain ID %s',
    (chainId) => {
      expect(() => getSmartAccountUserOpHash(operation, chainId)).toThrow(
        'valid chain ID'
      );
    }
  );

  it.each([
    '0x7702',
    `0x7702${'00'.repeat(18)}`,
    `0x7702${'00'.repeat(18)}abcd`,
  ])('fails closed on unsupported EIP-7702 initCode %s', (initCode) => {
    expect(() =>
      getSmartAccountUserOpHash({ ...operation, initCode }, CHAIN_ID)
    ).toThrow('EIP-7702');
  });

  it('fails closed on unsupported paymaster hash semantics', () => {
    expect(() =>
      getSmartAccountUserOpHash(
        { ...operation, paymasterAndData: '0x1234' },
        CHAIN_ID
      )
    ).toThrow('Paymaster');
  });
});
