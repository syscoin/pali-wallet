import { TypedDataEncoder, hashMessage } from 'ethers/hash';
import { getBytes, toUtf8Bytes } from 'ethers/utils';

import { buildSmartAccountUserOperation } from './account';
import {
  buildPaliErc7739PersonalSigningIntent,
  buildPaliErc7739TypedDataRequest,
  getPaliErc7739PersonalSignHash,
} from './erc7739';
import {
  assertSmartAccountOwnerSigningIntent,
  type SmartAccountOwnerSigningIntent,
} from './ownerSigningIntent';
import {
  buildSmartAccountUserOpSigningIntent,
  getSmartAccountUserOpHash,
} from './userOperationHash';

const SMART = '0x' + '11'.repeat(20),
  APP = '0x' + '22'.repeat(20);
const hash = (intent: SmartAccountOwnerSigningIntent) => {
  if (intent.representation !== 'eip712')
    throw new Error('Typed representation expected');
  const types = { ...intent.typedData.types };
  delete types.EIP712Domain;
  return TypedDataEncoder.hash(
    intent.typedData.domain,
    types,
    intent.typedData.message
  );
};

it('uses the existing contract UserOp vector as the exact device signing digest', () => {
  const userOperation = buildSmartAccountUserOperation({
    sender: SMART,
    nonce: '18446744073709551617',
    initCode: '0x22222222222222222222222222222222222222221234',
    callData: '0xdeadbeef0102',
    accountGasLimits:
      '0x000000000000000000000000000249f00000000000000000000000000001d4c0',
    preVerificationGas: '55000',
    gasFees:
      '0x0000000000000000000000003b9aca00000000000000000000000002540be400',
  });
  const intent = buildSmartAccountUserOpSigningIntent(userOperation, 57057);
  expect(intent.actionHash).toBe(
    '0x1a0dddd6c5cd562fb5692e50e66f40829620a0ae86bf81d22cf54afa0bb431e2'
  );
  expect(hash(intent)).toBe(intent.actionHash);
  expect(getSmartAccountUserOpHash(userOperation, 57057)).toBe(
    intent.actionHash
  );
  if (intent.representation !== 'eip712') throw new Error();
  expect(intent.typedData.primaryType).toBe('PackedUserOperation');
  expect(intent.typedData.message).not.toHaveProperty('signature');
  userOperation.callData = '0xffff';
  expect(hash(intent)).toBe(intent.actionHash);
  expect(Object.isFrozen(intent.typedData.message)).toBe(true);
});

it.each(['', '  ', '•\n日本語', '0x', '0x00ff', '0xe280a2'])(
  'uses the real original EIP191 prefixed bytes for %j',
  (message) => {
    const intent = buildPaliErc7739PersonalSigningIntent({
      accountAddress: SMART,
      chainId: 57057,
      message,
    });
    const bytes = message.startsWith('0x')
      ? getBytes(message)
      : toUtf8Bytes(message);
    expect(intent.actionHash).toBe(
      getPaliErc7739PersonalSignHash({
        accountAddress: SMART,
        chainId: 57057,
        hash: hashMessage(bytes),
      })
    );
    expect(hash(intent)).toBe(intent.actionHash);
    if (intent.representation !== 'eip712') throw new Error();
    const prefixed = getBytes(intent.typedData.message.prefixed as string);
    expect(
      new TextDecoder().decode(
        prefixed.slice(0, prefixed.length - bytes.length)
      )
    ).toBe(`\x19Ethereum Signed Message:\n${bytes.length}`);
    expect([...prefixed.slice(prefixed.length - bytes.length)]).toEqual([
      ...bytes,
    ]);
  }
);

function v4(
  primaryType = 'Mail',
  types = { Mail: [{ name: 'text', type: 'string' }] },
  message: Record<string, unknown> = { text: 'hello' }
) {
  return buildPaliErc7739TypedDataRequest({
    accountAddress: SMART,
    chainId: 1,
    typedData: {
      domain: { name: 'Original Dapp', chainId: 10, verifyingContract: APP },
      primaryType,
      types,
      message,
    },
  });
}
it('preserves original dapp domain and binds Smart identity within the ERC7739 wrapper', () => {
  const request = v4(),
    intent = request.ownerSigningIntent;
  expect(hash(intent)).toBe(request.actionHash);
  if (intent.representation !== 'eip712') throw new Error();
  expect(intent.typedData.domain).toMatchObject({
    name: 'Original Dapp',
    chainId: '0xa',
    verifyingContract: APP,
  });
  expect(intent.typedData.primaryType).toBe('TypedDataSign');
  expect(intent.typedData.message).toMatchObject({
    contents: { text: 'hello' },
    chainId: '1',
    verifyingContract: SMART,
    name: 'pali.smart-account.erc1271',
    version: '1',
    salt: '0x' + '00'.repeat(32),
  });
  assertSmartAccountOwnerSigningIntent(intent);
});
it.each([
  [
    'TypedDataSign',
    { TypedDataSign: [{ name: 'text', type: 'string' }] },
    { text: 'hello' },
  ],
  [
    'Zebra',
    {
      Zebra: [{ name: 'item', type: 'Apple' }],
      Apple: [{ name: 'text', type: 'string' }],
    },
    { item: { text: 'hello' } },
  ],
] as const)(
  'keeps exact existing software digest for device-unrepresentable %s without type/domain replacement',
  (primary, types, message) => {
    const request = v4(primary, types as any, message);
    expect(request.ownerSigningIntent).toEqual({
      actionHash: request.actionHash,
      purpose: 'erc7739-typed-data',
      representation: 'raw-only',
      reason: 'unrepresentable-types',
    });
    assertSmartAccountOwnerSigningIntent(request.ownerSigningIntent);
  }
);
it('rejects a substituted device payload rather than signing a matching caller-supplied label', () => {
  const intent = v4().ownerSigningIntent;
  if (intent.representation !== 'eip712') throw new Error();
  expect(() =>
    assertSmartAccountOwnerSigningIntent({
      ...intent,
      typedData: {
        ...intent.typedData,
        domain: { ...intent.typedData.domain, chainId: 1 },
      },
    })
  ).toThrow('digest changed');
});
