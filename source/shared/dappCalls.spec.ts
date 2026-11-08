import { DAPP_REQUEST_LIMITS } from '../utils/requestPayloadBudget';

import {
  assertDappCallsAtomicSupport,
  createSmartAccountCallsExecutions,
  normalizeDappCallsRequest,
} from './dappCalls';

const from = `0x${'11'.repeat(20)}`;
const to = `0x${'22'.repeat(20)}`;
const request = {
  version: '2.0.0',
  from,
  chainId: '0x1',
  calls: [{ to, value: '0x1', data: '0x' }],
};

describe('shared dapp calls request', () => {
  it.each(['1.0', '2.0.0'])(
    'preserves wire version %s, exact ordered values and bundle identity',
    (version) => {
      const large = (BigInt(1) << BigInt(255)).toString();
      const parsed = normalizeDappCallsRequest({
        ...request,
        version,
        id: '0xABC',
        calls: [
          { to, value: large, data: '0xAbCd' },
          { to: from, value: 1 },
          { to: 'recipient.eth', value: '0x0000' },
          { data: '0x1234' },
        ],
      });
      expect(parsed).toEqual({
        version,
        from,
        chainId: '0x1',
        id: '0xABC',
        atomicRequired: false,
        calls: [
          { to, value: `0x${BigInt(large).toString(16)}`, data: '0xAbCd' },
          { to: from, value: '0x1', data: '0x' },
          { to: 'recipient.eth', value: '0x0', data: '0x' },
          { value: '0x0', data: '0x1234' },
        ],
      });
      expect(normalizeDappCallsRequest(parsed)).toEqual(parsed);
    }
  );

  it('allows the host to bind omitted account and chain without trusting payload context', () => {
    expect(
      normalizeDappCallsRequest({
        version: '1.0',
        calls: [{ to }],
        approvedContext: { account: { address: from } },
        bundleId: 'page-selected',
        reservationId: 'page-selected',
      })
    ).toEqual({
      version: '1.0',
      atomicRequired: false,
      calls: [{ to, value: '0x0', data: '0x' }],
    });
  });

  it('detaches and freezes calls and optional capability data', () => {
    const input = {
      ...request,
      capabilities: { future: { optional: true, values: ['original'] } },
      calls: [
        {
          to,
          capabilities: { future: { optional: true, nested: { value: 1 } } },
        },
      ],
    };
    const parsed = normalizeDappCallsRequest(input);
    input.calls[0].to = from;
    input.capabilities.future.values[0] = 'changed';
    input.calls[0].capabilities.future.nested.value = 2;
    expect(parsed.calls[0].to).toBe(to);
    expect(parsed.capabilities?.future.values).toEqual(['original']);
    expect(parsed.calls[0].capabilities?.future.nested).toEqual({ value: 1 });
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.calls)).toBe(true);
    expect(Object.isFrozen(parsed.calls[0])).toBe(true);
    expect(Object.isFrozen(parsed.capabilities?.future.values)).toBe(true);
    expect(Object.isFrozen(parsed.calls[0].capabilities?.future.nested)).toBe(
      true
    );
  });

  it.each(['1.0', '2.0.0'])(
    'ignores nonstandard metadata while retaining optional capabilities in %s',
    (version) => {
      const capabilities = {
        future: { optional: true, metadata: ['retained'] },
      };
      const input = {
        ...request,
        version,
        metadata: { label: 'unrelated' },
        calls: [{ to, metadata: { label: 'unrelated' }, capabilities }],
      };
      const parsed = normalizeDappCallsRequest(input);
      expect(parsed.calls).toEqual([
        { to, value: '0x0', data: '0x', capabilities },
      ]);
      expect(parsed).not.toHaveProperty('metadata');
      expect(input.calls[0].metadata.label).toBe('unrelated');
    }
  );

  it.each([undefined, null, [], true, 'request'])(
    'rejects invalid request container %p',
    (input) => {
      expect(() => normalizeDappCallsRequest(input)).toThrow(
        expect.objectContaining({ code: -32602 })
      );
    }
  );

  it.each([
    { version: undefined },
    { version: '1.0.0' },
    { version: '2.1.0' },
    { version: 2 },
    { atomicRequired: null },
    { atomicRequired: 'false' },
    { from: 'invalid' },
    { from: null },
    { chainId: '0x0' },
    { chainId: '0x20000000000000' },
    { chainId: null },
    { calls: undefined },
    { calls: [] },
    { calls: {} },
    { calls: new Array(1) },
  ])('rejects malformed request fields %p', (fields) => {
    expect(() => normalizeDappCallsRequest({ ...request, ...fields })).toThrow(
      expect.objectContaining({ code: -32602 })
    );
  });

  it.each([
    null,
    [],
    'call',
    { to: '' },
    { to: 'invalid' },
    { to: [to] },
    { value: null },
    { value: false },
    { value: '' },
    { value: '0x' },
    { value: '-1' },
    { value: '1.1' },
    { value: Number.MAX_SAFE_INTEGER + 1 },
    { value: `0x1${'0'.repeat(64)}` },
    { data: '0x0' },
    { data: 'plaintext' },
    { data: null },
    { data: [] },
    { nonce: '0x1' },
    { gas: '0x5208' },
    { input: '0x1234' },
    { from },
    { chainId: '0x1' },
  ])('rejects malformed or unsupported per-call fields %p', (call) => {
    expect(() =>
      normalizeDappCallsRequest({ ...request, calls: [{ to }, call] })
    ).toThrow(expect.objectContaining({ code: -32602 }));
  });

  it.each([
    'from',
    'chainId',
    'nonce',
    'gas',
    'gasLimit',
    'gasPrice',
    'maxFeePerGas',
    'maxPriorityFeePerGas',
    'type',
    'accessList',
    'input',
    'authorizationList',
    'blobVersionedHashes',
    'blobs',
    'maxFeePerBlobGas',
    'kzg',
    'signature',
    'hash',
  ])('rejects the ignored transaction constraint %s', (field) => {
    expect(() =>
      normalizeDappCallsRequest({
        ...request,
        calls: [{ to, [field]: '0x1' }],
      })
    ).toThrow(expect.objectContaining({ code: -32602 }));
  });

  it.each([
    null,
    [],
    { unknown: null },
    { unknown: [] },
    {
      unknown: { optional: 'true' },
    },
  ])('rejects malformed capabilities at either level %p', (capabilities) => {
    for (const fields of [{ capabilities }, { calls: [{ to, capabilities }] }])
      expect(() =>
        normalizeDappCallsRequest({ ...request, ...fields })
      ).toThrow(expect.objectContaining({ code: -32602 }));
  });

  it.each([{ unknown: {} }, { unknown: { optional: false } }])(
    'rejects required capabilities at either level %p',
    (capabilities) => {
      for (const fields of [
        { capabilities },
        { calls: [{ to, capabilities }] },
      ])
        expect(() =>
          normalizeDappCallsRequest({ ...request, ...fields })
        ).toThrow(expect.objectContaining({ code: 5700 }));
    }
  );

  it.each(['0x1', '0xABC', `0x${'ab'.repeat(4096)}`])(
    'retains valid opaque bundle id %s',
    (id) => {
      expect(normalizeDappCallsRequest({ ...request, id }).id).toBe(id);
    }
  );
  it.each([null, 1, '', '0x', '0X1', '0xg', `0x${'ab'.repeat(4097)}`])(
    'rejects invalid bundle id %s',
    (id) => {
      expect(() => normalizeDappCallsRequest({ ...request, id })).toThrow(
        expect.objectContaining({ code: -32602 })
      );
    }
  );

  it('bounds calls and payload before copying, without truncating input', () => {
    const calls = Array.from({ length: 50 }, () => ({ to }));
    expect(normalizeDappCallsRequest({ ...request, calls }).calls).toHaveLength(
      50
    );
    calls.push({ to });
    expect(() => normalizeDappCallsRequest({ ...request, calls })).toThrow(
      expect.objectContaining({ code: -32602 })
    );
    expect(calls).toHaveLength(51);
    expect(() =>
      normalizeDappCallsRequest({
        ...request,
        calls: [{ data: `0x${'ab'.repeat(DAPP_REQUEST_LIMITS.batchBytes)}` }],
      })
    ).toThrow(expect.objectContaining({ code: -32602 }));
    expect(() =>
      normalizeDappCallsRequest({
        ...request,
        calls: [{ to, metadata: 'x'.repeat(DAPP_REQUEST_LIMITS.batchBytes) }],
      })
    ).toThrow(expect.objectContaining({ code: -32602 }));
    const getter = jest.fn();
    expect(() =>
      normalizeDappCallsRequest({
        ...request,
        calls: [
          Object.defineProperty({}, 'data', { enumerable: true, get: getter }),
        ],
      })
    ).toThrow(expect.objectContaining({ code: -32602 }));
    expect(getter).not.toHaveBeenCalled();
  });

  it('keeps required atomicity dependent on the host-supported account path', () => {
    const atomic = normalizeDappCallsRequest({
      ...request,
      atomicRequired: true,
    });
    const sequential = normalizeDappCallsRequest(request);
    expect(() => assertDappCallsAtomicSupport(atomic, false)).toThrow(
      expect.objectContaining({ code: 5760 })
    );
    expect(() => assertDappCallsAtomicSupport(atomic, true)).not.toThrow();
    expect(() => assertDappCallsAtomicSupport(sequential, false)).not.toThrow();
  });
});


describe('shared Smart ordered calls', () => {
  it('preserves exact ordered execution values for both hosts', () => {
    const amount = ((BigInt(1) << BigInt(256)) - BigInt(1)).toString();
    const calls = normalizeDappCallsRequest({ ...request, calls: [
      { to, value: amount, data: '0xaabb' }, { to: from, value: '0x0', data: '0x' },
    ] }).calls;
    expect(createSmartAccountCallsExecutions(calls)).toEqual([
      { target: to, value: `0x${BigInt(amount).toString(16)}`, data: '0xaabb' }, { target: from, value: '0x0', data: '0x' },
    ]);
    expect(Object.isFrozen(createSmartAccountCallsExecutions(calls))).toBe(true);
  });
  it.each([[{ data: '0x1234' }], [{ to: 'name.eth' }]])('requires resolved destinations before Smart execution', (calls) => {
    expect(() => createSmartAccountCallsExecutions(calls as any)).toThrow();
  });
});
