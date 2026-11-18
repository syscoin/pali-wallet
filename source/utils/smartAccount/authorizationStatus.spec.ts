import { EVM_READ_PHASE_TIMEOUT_MS } from '../../shared/evmReadPhase';

import { observeSmartAccountAuthorization } from './authorizationStatus';
import { getPaliEntryPointAddress, paliEntryPointInterface } from './contracts';
import type { SmartAccountAuthorizationSummary } from '../../wallet/smartAccountAuthorization';

const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const account = `0x${'11'.repeat(20)}`;
const other = `0x${'22'.repeat(20)}`;
const zero = `0x${'00'.repeat(20)}`;
const operationHash = hash(1),
  transactionHash = hash(2),
  headHash = hash(3),
  eventBlockHash = hash(4);
const key = BigInt(`0x${'a7'.repeat(24)}`);
const nonce = (key << BigInt(64)) + BigInt(7);
const entryPoint = getPaliEntryPointAddress(1);
const hex = (value: bigint) => `0x${value.toString(16)}`;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function fixture() {
  const summary = {
    account,
    chainId: '1',
    createdAt: 1,
    observedAt: { number: '90', hash: hash(5) },
    operationHash,
    operationNonce: nonce.toString(),
    payer: other,
  } satisfies SmartAccountAuthorizationSummary;
  const event = (
    changes: {
      hash?: string;
      nonce?: bigint;
      paymaster?: string;
      sender?: string;
      success?: boolean;
    } = {}
  ) =>
    paliEntryPointInterface.encodeEventLog(
      paliEntryPointInterface.getEvent('UserOperationEvent')!,
      [
        changes.hash ?? operationHash,
        changes.sender ?? account,
        changes.paymaster ?? zero,
        changes.nonce ?? nonce,
        changes.success ?? true,
        BigInt(12),
        BigInt(3),
      ]
    );
  const log: any = {
    address: entryPoint,
    removed: false,
    transactionHash,
    blockHash: eventBlockHash,
    blockNumber: '0x5f',
    logIndex: '0x2',
    ...event(),
  };
  const receipt: any = {
    status: '0x1',
    transactionHash,
    blockHash: eventBlockHash,
    blockNumber: '0x5f',
    logs: [copy(log)],
  };
  const state = {
    chain: '0x1',
    currentNonce: nonce + BigInt(1),
    head: { number: '0x64', hash: headHash },
    canonicalHead: { number: '0x64', hash: headHash },
    canonicalEvent: { number: '0x5f', hash: eventBlockHash },
    logs: [log] as unknown,
    current: true,
  };
  const lifetime = new AbortController();
  const read = jest.fn(
    async (method: string, params: readonly unknown[]): Promise<unknown> => {
      if (method === 'eth_chainId') return state.chain;
      if (method === 'eth_getBlockByNumber') {
        if (params[0] === 'latest') return state.head;
        if (params[0] === state.head.number) return state.canonicalHead;
        if (params[0] === '0x5f') return state.canonicalEvent;
      }
      if (method === 'eth_getLogs') return state.logs;
      if (method === 'eth_getTransactionReceipt') return receipt;
      if (method === 'eth_call') return word(state.currentNonce);
      throw Error(`Unexpected RPC ${method}`);
    }
  );
  const signals: AbortSignal[] = [];
  const provider = {
    signal: lifetime.signal,
    send: read,
    async verifyConfiguredChainId(fresh?: boolean) {
      expect(fresh).toBe(true);
      if ((await read('eth_chainId', [])) !== '0x1')
        throw Error('Configured chain changed');
    },
    readMany: jest.fn(
      async (
        requests: readonly { method: string; params: readonly unknown[] }[],
        options?: { signal: AbortSignal }
      ) => {
        expect(options?.signal).toBeDefined();
        signals.push(options!.signal);
        return Promise.allSettled(
          requests.map(({ method, params }) => read(method, params))
        );
      }
    ),
  };
  const assertCurrent = () => {
    if (!state.current) throw Error('retired');
  };
  const observe = (expectedChainId = 1) =>
    observeSmartAccountAuthorization(
      summary,
      provider,
      assertCurrent,
      expectedChainId
    );
  return {
    summary,
    log,
    receipt,
    state,
    provider,
    read,
    signals,
    lifetime,
    observe,
    event,
  };
}

it.each([true, false])(
  'observes exact canonical UserOperation outcome success=%s through a real read phase',
  async (success) => {
    const f = fixture();
    Object.assign(f.log, f.event({ success }));
    f.receipt.logs = [copy(f.log)];
    const result = await f.observe();
    expect(result).toEqual({
      kind: 'observed',
      success,
      operationHash,
      transactionHash,
      currentNonce: (nonce + BigInt(1)).toString(),
      anchor: { number: '100', hash: headHash },
      block: { number: '95', hash: eventBlockHash },
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(
      f.read.mock.calls.filter(([method]) => method === 'eth_chainId')
    ).toHaveLength(2);
    expect(
      f.read.mock.calls
        .filter(([method]) => method === 'eth_getBlockByNumber')
        .map(([, params]) => params)
    ).toEqual([
      ['latest', false],
      ['0x5f', false],
      ['0x64', false],
    ]);
    expect(f.signals.every((signal) => signal.aborted)).toBe(true);
    const nonceCall = f.read.mock.calls.find(
      ([method]) => method === 'eth_call'
    )![1];
    const tx = nonceCall[0] as { data: string; to: string };
    expect(tx.to).toBe(entryPoint);
    const decoded = paliEntryPointInterface.decodeFunctionData(
      'getNonce',
      tx.data
    );
    expect(decoded[0].toLowerCase()).toBe(account);
    expect(decoded[1]).toBe(key);
    expect(nonceCall[1]).toBe('0x64');
  }
);

it.each([
  ['pending', nonce],
  ['pending', nonce - BigInt(1)],
  ['nonce-consumed', nonce + BigInt(1)],
] as const)(
  'no exact event yields %s without inventing execution or cancellation',
  async (kind, currentNonce) => {
    const f = fixture();
    f.state.logs = [];
    f.state.currentNonce = currentNonce;
    const result = await f.observe();
    expect(result).toEqual({
      kind,
      operationHash,
      currentNonce: currentNonce.toString(),
      anchor: { number: '100', hash: headHash },
    });
    for (const field of ['success', 'transactionHash', 'block', 'cancelled'])
      expect(result).not.toHaveProperty(field);
    expect(
      f.read.mock.calls.some(
        ([method]) => method === 'eth_getTransactionReceipt'
      )
    ).toBe(false);
  }
);

it.each([
  { head: 9000, origin: 100, from: 6953 },
  { head: 9000, origin: 8000, from: 8000 },
  { head: 9000, origin: 9500, from: 6953 },
  { head: 2047, origin: 0, from: 0 },
  { head: 2048, origin: 0, from: 1 },
])(
  'bounds log exploration to at most 2048 blocks: %j',
  async ({ head, origin, from }) => {
    const f = fixture();
    f.state.logs = [];
    f.state.head.number = hex(BigInt(head));
    f.state.canonicalHead.number = hex(BigInt(head));
    f.summary.observedAt = { number: String(origin), hash: hash(5) };
    await f.observe();
    const filter = f.read.mock.calls.find(
      ([method]) => method === 'eth_getLogs'
    )![1][0] as any;
    expect(filter).toEqual({
      address: entryPoint,
      fromBlock: hex(BigInt(from)),
      toBlock: hex(BigInt(head)),
      topics: [
        paliEntryPointInterface.getEvent('UserOperationEvent')!.topicHash,
        operationHash,
        '0x' + account.slice(2).padStart(64, '0'),
      ],
    });
    expect(head - from + 1).toBeLessThanOrEqual(2048);
  }
);

it('rejects an explicit wrong selected network before initiating any RPC', async () => {
  const f = fixture();
  await expect(f.observe(2)).rejects.toThrow('STATUS_UNAVAILABLE');
  expect(f.read).not.toHaveBeenCalled();
  expect(f.provider.readMany).not.toHaveBeenCalled();
});

it.each(['initial', 'final'] as const)(
  'validates the actual endpoint chain at the %s phase boundary',
  async (boundary) => {
    const f = fixture();
    if (boundary === 'initial') f.state.chain = '0x2';
    else {
      const read = f.read.getMockImplementation()!;
      f.read.mockImplementation(async (...args) => {
        const result = await read(...args);
        if (args[0] === 'eth_getBlockByNumber' && args[1][0] === '0x64')
          f.state.chain = '0x2';
        return result;
      });
    }
    await expect(f.observe()).rejects.toThrow('Configured chain changed');
    if (boundary === 'initial')
      expect(f.read.mock.calls.map(([method]) => method)).toEqual([
        'eth_chainId',
      ]);
  }
);

it.each([
  'operation-hash',
  'sender',
  'paymaster',
  'nonce',
  'entrypoint',
  'removed',
  'duplicate',
  'topics',
  'data',
  'ahead',
  'before-origin',
  'wrong-nonce-key',
  'missing-log-index',
  'invalid-log-index',
])('rejects nonmatching or malformed event observation: %s', async (kind) => {
  const f = fixture();
  if (kind === 'operation-hash')
    Object.assign(f.log, f.event({ hash: hash(9) }));
  if (kind === 'sender') Object.assign(f.log, f.event({ sender: other }));
  if (kind === 'paymaster') Object.assign(f.log, f.event({ paymaster: other }));
  if (kind === 'nonce')
    Object.assign(f.log, f.event({ nonce: nonce + BigInt(1) }));
  if (kind === 'entrypoint') f.log.address = other;
  if (kind === 'removed') f.log.removed = true;
  if (kind === 'missing-log-index') delete f.log.logIndex;
  if (kind === 'invalid-log-index') f.log.logIndex = 'garbage';
  if (kind === 'duplicate') f.state.logs = [f.log, copy(f.log)];
  if (kind === 'topics') f.log.topics = f.log.topics.slice(0, 3);
  if (kind === 'data') f.log.data = '0x00';
  if (kind === 'ahead') f.log.blockNumber = '0x65';
  if (kind === 'before-origin') f.log.blockNumber = '0x59';
  if (kind === 'wrong-nonce-key')
    f.state.currentNonce = ((key + BigInt(1)) << BigInt(64)) + BigInt(8);
  f.receipt.logs = [copy(f.log)];
  await expect(f.observe()).rejects.toThrow();
});

it.each([
  'no-consumption',
  'missing',
  'failed',
  'hash',
  'block-hash',
  'block-number',
  'event-missing',
  'duplicate-event',
  'removed-event',
  'changed-data',
  'canonical-event',
  'canonical-head',
])(
  'refuses incomplete, stale or reorged receipt evidence: %s',
  async (kind) => {
    const f = fixture();
    if (kind === 'no-consumption') f.state.currentNonce = nonce;
    if (kind === 'missing') {
      const read = f.read.getMockImplementation()!;
      f.read.mockImplementation(async (...args) =>
        args[0] === 'eth_getTransactionReceipt' ? null : read(...args)
      );
    }
    if (kind === 'failed') f.receipt.status = '0x0';
    if (kind === 'hash') f.receipt.transactionHash = hash(9);
    if (kind === 'block-hash') f.receipt.blockHash = hash(9);
    if (kind === 'block-number') f.receipt.blockNumber = '0x5e';
    if (kind === 'event-missing') f.receipt.logs = [];
    if (kind === 'duplicate-event') f.receipt.logs.push(copy(f.log));
    if (kind === 'removed-event') f.receipt.logs[0].removed = true;
    if (kind === 'changed-data')
      f.receipt.logs[0].data = f.event({ success: false }).data;
    if (kind === 'canonical-event') f.state.canonicalEvent.hash = hash(9);
    if (kind === 'canonical-head') f.state.canonicalHead.hash = hash(9);
    await expect(f.observe()).rejects.toThrow();
  }
);

it.each(['oversized-logs', 'oversized-receipt', 'bad-nonce'] as const)(
  'refuses bounded-response violations: %s',
  async (kind) => {
    const f = fixture();
    if (kind === 'oversized-logs') f.log.extra = 'x'.repeat(16 * 1024);
    if (kind === 'oversized-receipt')
      f.receipt.logs.push({ extra: 'x'.repeat(1024 * 1024) });
    if (kind === 'bad-nonce') {
      const read = f.read.getMockImplementation()!;
      f.read.mockImplementation(async (...args) =>
        args[0] === 'eth_call' ? '0x1' : read(...args)
      );
    }
    await expect(f.observe()).rejects.toThrow();
  }
);

it.each(['before', 'during'] as const)(
  'retired owner stops observation %s RPC work',
  async (when) => {
    const f = fixture();
    if (when === 'before') f.state.current = false;
    else {
      const read = f.read.getMockImplementation()!;
      f.read.mockImplementation(async (...args) => {
        const result = await read(...args);
        if (args[0] === 'eth_getLogs') f.state.current = false;
        return result;
      });
    }
    await expect(f.observe()).rejects.toThrow('retired');
    expect(
      f.read.mock.calls.some(
        ([method]) => method === 'eth_getTransactionReceipt'
      )
    ).toBe(false);
    if (when === 'before') expect(f.read).not.toHaveBeenCalled();
  }
);

it.each(['timeout', 'provider-abort'] as const)(
  'retires a stalled owned read on %s without publishing a status',
  async (reason) => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask'] });
    try {
      const f = fixture();
      const read = f.read.getMockImplementation()!;
      f.read.mockImplementation(async (...args) =>
        args[0] === 'eth_getLogs' ? new Promise(() => undefined) : read(...args)
      );
      const pending = f.observe();
      const failure = expect(pending).rejects.toThrow(
        reason === 'timeout' ? 'timed out' : 'provider retired'
      );
      await jest.advanceTimersByTimeAsync(0);
      expect(f.signals.length).toBeGreaterThan(0);
      if (reason === 'provider-abort')
        f.lifetime.abort(Error('provider retired'));
      else await jest.advanceTimersByTimeAsync(EVM_READ_PHASE_TIMEOUT_MS);
      await failure;
      expect(f.signals.every((signal) => signal.aborted)).toBe(true);
      expect(
        f.read.mock.calls.some(
          ([method]) => method === 'eth_getTransactionReceipt'
        )
      ).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  }
);
