import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeDappCapabilitiesRequest,
  projectDappCapabilities,
} from '../../../source/shared/dappCapabilities.ts';
import { DAPP_REQUEST_LIMITS } from '../../../source/utils/requestPayloadBudget.ts';

const address = '0x1234567890abcdef1234567890abcdef12345678';
const chain = { chainId: 1, batchSupported: true, atomicSupported: false };
const scope = { accountAddress: address, chain };

for (const params of [undefined, [], [undefined]]) {
  test(`capability queries preserve omitted-address compatibility ${JSON.stringify(
    params
  )}`, () => {
    assert.deepEqual(normalizeDappCapabilitiesRequest(params), {});
    assert.deepEqual(
      projectDappCapabilities(normalizeDappCapabilitiesRequest(params), scope),
      {
        '0x1': { atomic: { status: 'unsupported' } },
      }
    );
  });
}

test('capability queries detach and freeze exact address and chain filters', () => {
  const chains = ['0x01', '0xa', '0xA'];
  const input = [address.toUpperCase().replace('0X', '0x'), chains];
  const request = normalizeDappCapabilitiesRequest(input);
  chains[0] = '0x2';
  input[0] = 'other';
  assert.deepEqual(request, { address, chains: ['0x1', '0xa', '0xa'] });
  assert(Object.isFrozen(request));
  assert(Object.isFrozen(request.chains));
  assert.deepEqual(projectDappCapabilities(request, scope), {
    '0x1': { atomic: { status: 'unsupported' } },
  });
});

for (const params of [
  null,
  {},
  [null],
  ['other'],
  [address, null],
  [address, '0x1'],
  [address, ['0x']],
  [address, ['1']],
  [address, [1]],
  [address, ['-0x1']],
  [address, [], 'extra'],
]) {
  test(`malformed capability parameters are rejected ${JSON.stringify(
    params
  )}`, () => {
    assert.throws(() => normalizeDappCapabilitiesRequest(params), {
      code: -32602,
    });
  });
}

test('capability parser rejects accessors and oversized input before reading it', () => {
  let reads = 0;
  const params: unknown[] = [];
  Object.defineProperty(params, '0', {
    enumerable: true,
    get() {
      reads++;
      return address;
    },
  });
  assert.throws(() => normalizeDappCapabilitiesRequest(params), {
    code: -32602,
  });
  assert.equal(reads, 0);
  assert.throws(
    () =>
      normalizeDappCapabilitiesRequest([
        address,
        ['0x' + '1'.repeat(DAPP_REQUEST_LIMITS.bytes)],
      ]),
    { code: -32602 }
  );
});

test('capability projection distinguishes missing batching, sequential batching and atomic batching', () => {
  const request = normalizeDappCapabilitiesRequest([address]);
  assert.deepEqual(
    projectDappCapabilities(request, {
      ...scope,
      chain: { ...chain, batchSupported: false },
    }),
    { '0x1': {} }
  );
  assert.deepEqual(projectDappCapabilities(request, scope), {
    '0x1': { atomic: { status: 'unsupported' } },
  });
  assert.deepEqual(
    projectDappCapabilities(request, {
      ...scope,
      chain: { ...chain, atomicSupported: true },
    }),
    { '0x1': { atomic: { status: 'supported' } } }
  );
});

test('capability projection omits filtered and unauthorized chains', () => {
  for (const chains of [[], ['0x2']]) {
    assert.deepEqual(
      projectDappCapabilities(
        normalizeDappCapabilitiesRequest([address, chains]),
        scope
      ),
      {}
    );
  }
  assert.deepEqual(
    projectDappCapabilities(normalizeDappCapabilitiesRequest([address]), {
      ...scope,
      chain: null,
    }),
    {}
  );
});

test('capability projection requires the granted account even for an empty chain filter', () => {
  assert.throws(
    () =>
      projectDappCapabilities(
        normalizeDappCapabilitiesRequest(['0x' + '22'.repeat(20), []]),
        scope
      ),
    { code: 4100 }
  );
  assert.throws(
    () =>
      projectDappCapabilities(normalizeDappCapabilitiesRequest(undefined), {
        ...scope,
        accountAddress: undefined,
      }),
    { code: 4100 }
  );
});
