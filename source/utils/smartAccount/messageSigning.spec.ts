import { getAddress } from 'ethers/address';

import {
  readDappMessageRequest,
  type DappMessageRequest,
} from '../../shared/dappMessageRequest';

import {
  buildPaliErc7739TypedDataRequest,
  encodePaliErc7739TypedDataSignature,
  getPaliErc7739PersonalSignHash,
  hashPersonalSignMessage,
} from './erc7739';
import {
  encodeSmartAccountMessageSignature,
  prepareSmartAccountMessage,
} from './messageSigning';
import { encodeSmartAccountAuthenticatorSignature } from './signature';

const account = '0x' + '11'.repeat(20);
const validator = getAddress('0x' + '22'.repeat(20));
const signature = '0x' + '33'.repeat(65);
const payload = () => ({
  domain: {
    name: 'Other app',
    version: '1',
    chainId: 10,
    verifyingContract: '0x' + '44'.repeat(20),
  },
  primaryType: 'Mail',
  types: { EIP712Domain: [], Mail: [{ name: 'text', type: 'string' }] },
  message: { text: 'A signed message' },
});
const prepare = (request: DappMessageRequest, chainId = 1) =>
  prepareSmartAccountMessage({ accountAddress: account, chainId, request });

it.each(['a message', '0xe280a2', '0x'])(
  'shares the extension personal digest for %s and includes its validator',
  (message) => {
    const request = readDappMessageRequest(
      'personal_sign',
      [message, account],
      account
    )!;
    const result = prepare(request);
    expect(result.actionHash).toBe(
      getPaliErc7739PersonalSignHash({
        accountAddress: account,
        chainId: 1,
        hash: hashPersonalSignMessage(message),
      })
    );
    expect(
      encodeSmartAccountMessageSignature(result, { validator, signature })
    ).toBe(validator + signature.slice(2));
    expect(prepare(request, 2).actionHash).not.toBe(result.actionHash);
  }
);

it('shares the exact nested V4 digest and proof while preserving the application domain chain', () => {
  const typedData = payload();
  const request = readDappMessageRequest(
    'eth_signTypedData_v4',
    [account, typedData],
    account
  )!;
  const result = prepare(request);
  const expected = buildPaliErc7739TypedDataRequest({
    accountAddress: account,
    chainId: 1,
    typedData,
  });
  expect(result.actionHash).toBe(expected.actionHash);
  expect(result.actionHash).not.toBe(expected.originalHash);
  expect(
    encodeSmartAccountMessageSignature(result, { validator, signature })
  ).toBe(
    encodePaliErc7739TypedDataSignature(
      encodeSmartAccountAuthenticatorSignature({ validator, signature }),
      expected
    )
  );
  typedData.domain.chainId = 1;
  typedData.message.text = 'mutated';
  expect(
    encodeSmartAccountMessageSignature(result, { validator, signature })
  ).toBe(
    encodePaliErc7739TypedDataSignature(
      validator + signature.slice(2),
      expected
    )
  );
});

it.each(['eth_signTypedData', 'eth_signTypedData_v3'])(
  'retains the Smart-account rejection of %s',
  (method) => {
    const request =
      method === 'eth_signTypedData'
        ? readDappMessageRequest(
            method,
            [account, [{ name: 'text', type: 'string', value: 'hello' }]],
            account
          )!
        : readDappMessageRequest(method, [account, payload()], account)!;
    expect(() => prepare(request)).toThrow('only eth_signTypedData_v4');
  }
);

it('rejects a different account or inconsistent version rather than using an injected digest', () => {
  const request = readDappMessageRequest(
    'eth_signTypedData_v4',
    [account, payload()],
    account
  )!;
  expect(() =>
    prepareSmartAccountMessage({
      accountAddress: validator,
      chainId: 1,
      request,
    })
  ).toThrow();
  expect(() =>
    prepare({ ...request, version: 'V3' } as DappMessageRequest)
  ).toThrow('version changed');
  expect(
    prepare({
      ...request,
      actionHash: '0x' + '00'.repeat(32),
    } as unknown as DappMessageRequest).actionHash
  ).not.toBe('0x' + '00'.repeat(32));
});
