import {
  _TypedDataEncoder,
  defaultAbiCoder,
  hexConcat,
  keccak256,
  toUtf8Bytes,
} from 'utils/ethersV6Compat';

import {
  assertPaliErc7739TypedDataV4Method,
  buildPaliErc7739TypedDataRequest,
  encodePaliErc7739TypedDataSignature,
  getPaliErc7739DomainSeparator,
  getPaliErc7739PersonalSignHash,
  PALI_ERC7739_DOMAIN_NAME,
  PALI_ERC7739_DOMAIN_VERSION,
  signPaliErc7739TypedDataV4,
} from './erc7739';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const OTHER_ACCOUNT = '0x2222222222222222222222222222222222222222';
const APP = '0x3333333333333333333333333333333333333333';
const CHAIN_ID = 5700;

describe('Pali ERC-7739 helpers', () => {
  it('binds personal signatures to the account EIP-712 domain', () => {
    const hash = keccak256(toUtf8Bytes('application challenge'));
    const personalTypeHash = keccak256(
      toUtf8Bytes('PersonalSign(bytes prefixed)')
    );
    const expected = keccak256(
      hexConcat([
        '0x1901',
        getPaliErc7739DomainSeparator({
          accountAddress: ACCOUNT,
          chainId: CHAIN_ID,
        }),
        keccak256(
          defaultAbiCoder.encode(
            ['bytes32', 'bytes32'],
            [personalTypeHash, hash]
          )
        ),
      ])
    );

    expect(
      getPaliErc7739PersonalSignHash({
        accountAddress: ACCOUNT,
        chainId: CHAIN_ID,
        hash,
      })
    ).toBe(expected);
    expect(expected).toBe(
      '0x7016590c1bd779be0dd58802ab645f1460e7223c7c6579f2e30dc822bd306011'
    );
    expect(
      getPaliErc7739PersonalSignHash({
        accountAddress: OTHER_ACCOUNT,
        chainId: CHAIN_ID,
        hash,
      })
    ).not.toBe(expected);
  });

  it('builds and serializes a typed-data signature accepted by ERC-7739', () => {
    const typedData = {
      domain: {
        chainId: CHAIN_ID,
        name: 'Pali Test App',
        verifyingContract: APP,
        version: '1',
      },
      message: { message: 'Hello, Pali!', value: 42 },
      primaryType: 'MockMessage',
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
        MockMessage: [
          { name: 'message', type: 'string' },
          { name: 'value', type: 'uint256' },
        ],
        Unreachable: [{ name: 'ignored', type: 'bytes32' }],
      },
    };
    const request = buildPaliErc7739TypedDataRequest({
      accountAddress: ACCOUNT,
      chainId: CHAIN_ID,
      typedData,
    });

    expect(request.contentsDescription).toBe(
      'MockMessage(string message,uint256 value)'
    );
    expect(request.contentsHash).toBe(
      '0x51bef60968d2fe52bac743fb1d522ed87445ecda97081ac5008ac4409409a617'
    );
    expect(request.contentsHash).toBe(
      _TypedDataEncoder.hashStruct(
        'MockMessage',
        { MockMessage: typedData.types.MockMessage },
        typedData.message
      )
    );
    expect(request.originalHash).toBe(
      _TypedDataEncoder.hash(
        typedData.domain,
        { MockMessage: typedData.types.MockMessage },
        typedData.message
      )
    );
    expect(request.originalHash).toBe(
      '0x4421c2826b53867e733061876a7b663e822735b52b167b1eba529cef9e52913a'
    );

    const descriptionLength = toUtf8Bytes(request.contentsDescription).length;
    const signature = encodePaliErc7739TypedDataSignature('0x1234', request);
    expect(signature).toBe(
      hexConcat([
        '0x1234',
        request.appDomainSeparator,
        request.contentsHash,
        toUtf8Bytes(request.contentsDescription),
        `0x${descriptionLength.toString(16).padStart(4, '0')}`,
      ])
    );

    const nestedTypeHash = keccak256(
      toUtf8Bytes(
        `TypedDataSign(MockMessage contents,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)${request.contentsDescription}`
      )
    );
    const expectedActionHash = keccak256(
      hexConcat([
        '0x1901',
        request.appDomainSeparator,
        keccak256(
          defaultAbiCoder.encode(
            [
              'bytes32',
              'bytes32',
              'bytes32',
              'bytes32',
              'uint256',
              'address',
              'bytes32',
            ],
            [
              nestedTypeHash,
              request.contentsHash,
              keccak256(toUtf8Bytes(PALI_ERC7739_DOMAIN_NAME)),
              keccak256(toUtf8Bytes(PALI_ERC7739_DOMAIN_VERSION)),
              CHAIN_ID,
              ACCOUNT,
              `0x${'00'.repeat(32)}`,
            ]
          )
        ),
      ])
    );
    const accountDomainActionHash = keccak256(
      hexConcat([
        '0x1901',
        getPaliErc7739DomainSeparator({
          accountAddress: ACCOUNT,
          chainId: CHAIN_ID,
        }),
        keccak256(
          defaultAbiCoder.encode(
            [
              'bytes32',
              'bytes32',
              'bytes32',
              'bytes32',
              'uint256',
              'address',
              'bytes32',
            ],
            [
              nestedTypeHash,
              request.contentsHash,
              keccak256(toUtf8Bytes(PALI_ERC7739_DOMAIN_NAME)),
              keccak256(toUtf8Bytes(PALI_ERC7739_DOMAIN_VERSION)),
              CHAIN_ID,
              ACCOUNT,
              `0x${'00'.repeat(32)}`,
            ]
          )
        ),
      ])
    );
    expect(request.actionHash).toBe(expectedActionHash);
    // ERC-7739 uses the application separator as the outer EIP-712 domain;
    // the smart-account domain is already bound inside nestedStructHash.
    expect(request.actionHash).not.toBe(accountDomainActionHash);
    expect(request.actionHash).toBe(
      '0x17dc033452b12673364b15ed0871194ca9f5e01de0d02e954c10404ea1865f13'
    );
  });

  it('does not sign a Pali-labeled dapp actionHash as a raw digest', async () => {
    const attackerChosenUserOpHash = keccak256(
      toUtf8Bytes('attacker-chosen UserOperation')
    );
    const typedData = {
      domain: {
        chainId: CHAIN_ID,
        name: 'Untrusted Dapp',
        verifyingContract: APP,
        version: '1',
      },
      message: {
        actionHash: attackerChosenUserOpHash,
        requestType: 'smartaccount.execute',
      },
      primaryType: 'PaliSmartAccountExecution',
      types: {
        PaliSmartAccountExecution: [
          { name: 'actionHash', type: 'bytes32' },
          { name: 'requestType', type: 'string' },
        ],
      },
    };

    const request = buildPaliErc7739TypedDataRequest({
      accountAddress: ACCOUNT,
      chainId: CHAIN_ID,
      typedData,
    });
    const otherAccountRequest = buildPaliErc7739TypedDataRequest({
      accountAddress: OTHER_ACCOUNT,
      chainId: CHAIN_ID,
      typedData,
    });
    let signedActionHash = '';
    const signature = await signPaliErc7739TypedDataV4({
      accountAddress: ACCOUNT,
      chainId: CHAIN_ID,
      signActionHash: async (actionHash) => {
        signedActionHash = actionHash;
        return '0x1234';
      },
      typedData,
    });

    expect(request.actionHash).not.toBe(attackerChosenUserOpHash);
    expect(request.actionHash).not.toBe(otherAccountRequest.actionHash);
    expect(signedActionHash).toBe(request.actionHash);
    expect(signedActionHash).not.toBe(attackerChosenUserOpHash);
    expect(signature).toBe(
      encodePaliErc7739TypedDataSignature('0x1234', request)
    );
    expect(request.originalHash).toBe(
      _TypedDataEncoder.hash(
        typedData.domain,
        {
          PaliSmartAccountExecution: typedData.types.PaliSmartAccountExecution,
        },
        typedData.message
      )
    );
  });

  it('accepts only V4 at the smart-account typed-data RPC boundary', () => {
    expect(() =>
      assertPaliErc7739TypedDataV4Method('eth_signTypedData_v3')
    ).toThrow(
      'Smart accounts support only eth_signTypedData_v4 typed-data signing'
    );
    expect(() =>
      assertPaliErc7739TypedDataV4Method('eth_signTypedData_v4')
    ).not.toThrow();
  });
});
