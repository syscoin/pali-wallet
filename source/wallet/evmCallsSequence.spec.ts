import {
  createEoaCallsSequence,
  type EoaCallsPorts,
  type EoaCallsProgress,
} from './evmCallsSequence';

const from = '0x' + '11'.repeat(20),
  to = '0x' + '22'.repeat(20),
  other = '0x' + '33'.repeat(20);
const hashes = ['0x' + 'aa'.repeat(32), '0x' + 'bb'.repeat(32)];
const request = {
  version: '2.0.0',
  from,
  chainId: '0x1',
  calls: [
    { to, value: '0x1', data: '0x' },
    { to: other, value: '0x2', data: '0x1234' },
  ],
};
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function fixture(input: unknown = request) {
  let live = true;
  const events: unknown[] = [],
    progress: EoaCallsProgress[] = [],
    saved: string[] = [];
  const ports: EoaCallsPorts = {
    assertCurrent() {
      if (!live) throw new Error('owner retired');
    },
    async nonce() {
      events.push('nonce');
      return 5 + saved.length;
    },
    async begin() {
      events.push('begin');
      return 'attempt';
    },
    async resolveAddress() {
      return other;
    },
    async prepare(transaction) {
      events.push('review');
      return Object.freeze({
        transaction: Object.freeze({
          ...transaction,
          chainId: String(transaction.chainId),
          nonce: String(transaction.nonce),
          value: BigInt(transaction.value).toString(),
          to: transaction.to ?? null,
          type: 2 as const,
          gasLimit: '65000',
          accessList: [],
          maxFeePerGas: '3',
          maxPriorityFeePerGas: '1',
        }),
      });
    },
    async send(review, submissionId) {
      events.push({ transaction: review.transaction, submissionId });
      return { hash: hashes[saved.length] };
    },
    async persistHash(hash) {
      events.push(['persist', hash]);
      saved.push(hash);
    },
    async persistStopped() {
      return undefined;
    },
    async recordNotBroadcast() {
      events.push('not-broadcast');
      return true;
    },
    async persistCompletion(value) {
      events.push(['complete', value]);
    },
    update(value) {
      progress.push(value);
    },
  };
  return {
    sequence: createEoaCallsSequence(input),
    ports,
    events,
    progress,
    saved,
    retire() {
      live = false;
    },
  };
}

it('snapshots exact ordered calls and persists each hash before sending the next', async () => {
  const input = JSON.parse(JSON.stringify(request));
  const f = fixture(input);
  input.calls[0].to = other;
  const held = deferred();
  let entered = false;
  f.ports = {
    ...f.ports,
    async persistHash(hash) {
      entered = true;
      await held.promise;
      f.saved.push(hash);
    },
  };
  const running = f.sequence.run(f.ports);
  while (!entered) await Promise.resolve();
  expect(f.events.filter((x) => typeof x === 'object')).toHaveLength(1);
  held.resolve();
  await running;
  const sent = f.events.filter(
    (x) => typeof x === 'object' && !Array.isArray(x)
  ) as any[];
  expect(sent.map((x) => x.transaction)).toEqual([
    {
      from,
      to,
      value: '1',
      data: '0x',
      chainId: '1',
      nonce: '5',
      type: 2,
      gasLimit: '65000',
      accessList: [],
      maxFeePerGas: '3',
      maxPriorityFeePerGas: '1',
    },
    {
      from,
      to: other,
      value: '2',
      data: '0x1234',
      chainId: '1',
      nonce: '6',
      type: 2,
      gasLimit: '65000',
      accessList: [],
      maxFeePerGas: '3',
      maxPriorityFeePerGas: '1',
    },
  ]);
});

it('gives a reported valid hash priority over a no-broadcast error and advances once', async () => {
  const f = fixture();
  let sent = 0;
  const result = await f.sequence.run({
    ...f.ports,
    async send(transaction) {
      f.events.push(Number(transaction.transaction.nonce));
      if (!sent++)
        throw Object.assign(new Error('lost acknowledgement'), {
          transactionHash: hashes[0],
          transactionNotBroadcast: true,
        });
      return hashes[1];
    },
  });
  expect(result).toMatchObject({ status: 'finished', failed: false, hashes });
  expect(f.events).not.toContain('not-broadcast');
  expect(f.events.filter((x) => typeof x === 'number')).toEqual([5, 6]);
});

it('retries only the first definitely unsent call and preserves the acknowledged prefix', async () => {
  const f = fixture();
  let count = 0;
  const sent: number[] = [];
  const ports = {
    ...f.ports,
    async send(transaction: Parameters<EoaCallsPorts['send']>[0]) {
      sent.push(Number(transaction.transaction.nonce));
      if (++count === 2)
        throw Object.assign(new Error('declined'), {
          transactionNotBroadcast: true,
        });
      return hashes[f.saved.length];
    },
  };
  expect(await f.sequence.run(ports)).toMatchObject({
    status: 'finished',
    failed: true,
    hashes: [hashes[0]],
  });
  expect(await f.sequence.run(ports)).toMatchObject({
    status: 'finished',
    failed: false,
    hashes: [hashes[1]],
  });
  expect(sent).toEqual([5, 6, 6]);
  expect(
    f.progress.filter((x) => x.status === 'success').map((x) => x.index)
  ).toEqual([0, 1]);
});

it('stops after an unknown send and refuses any retry', async () => {
  const f = fixture();
  const ports = {
    ...f.ports,
    async send() {
      throw new Error('timeout');
    },
  };
  expect(await f.sequence.run(ports)).toMatchObject({
    status: 'unknown',
    index: 0,
  });
  await expect(f.sequence.run(ports)).rejects.toThrow('unresolved');
  expect(f.events.filter((x) => x === 'begin')).toHaveLength(1);
  expect(f.events.some((x) => Array.isArray(x) && x[0] === 'complete')).toBe(
    false
  );
});

it('records a stopped attempt only after the sender settles, with its reviewed envelope', async () => {
  const f = fixture();
  const held = deferred();
  const stopped = jest.fn(async () => undefined);
  const sending = jest.fn(async () => {
    await held.promise;
    throw Object.assign(new Error('response lost'), {
      signedTransactionHash: hashes[0],
      transactionNotBroadcast: false,
    });
  });
  const running = f.sequence.run({
    ...f.ports,
    send: sending,
    persistStopped: stopped,
  });
  while (!sending.mock.calls.length) await Promise.resolve();
  expect(stopped).not.toHaveBeenCalled();
  held.resolve();
  expect(await running).toMatchObject({ status: 'unknown' });
  expect(stopped).toHaveBeenCalledTimes(1);
  expect(stopped).toHaveBeenCalledWith({
    failed: true,
    hash: hashes[0],
    transaction: expect.objectContaining({
      from,
      to,
      nonce: '5',
      gasLimit: '65000',
    }),
  });
  await expect(f.sequence.run(f.ports)).rejects.toThrow('unresolved');
});

it('retains an acknowledged hash and stops if its persistence fails', async () => {
  const f = fixture();
  const ports = {
    ...f.ports,
    async persistHash() {
      throw new Error('storage failed');
    },
  };
  expect(await f.sequence.run(ports)).toMatchObject({
    status: 'unknown',
    index: 0,
    hash: hashes[0],
  });
  await expect(f.sequence.run(ports)).rejects.toThrow('unresolved');
  expect(f.events.filter((x) => typeof x === 'object')).toHaveLength(1);
});

it('retries only terminal storage after completion persistence fails', async () => {
  const f = fixture();
  let fail = true;
  const complete = jest.fn(async () => {
    if (fail) throw new Error('storage failed');
  });
  const ports = { ...f.ports, persistCompletion: complete };
  await expect(f.sequence.run(ports)).rejects.toThrow('storage failed');
  await expect(f.sequence.run(ports)).rejects.toThrow('awaiting completion');
  fail = false;
  await f.sequence.retryCompletion();
  expect(complete).toHaveBeenCalledTimes(2);
  expect(f.events.filter((x) => x === 'begin')).toHaveLength(2);
});

it('does not dispatch after ownership changes while the durable begin waits', async () => {
  const f = fixture();
  let sent = 0;
  const result = await f.sequence.run({
    ...f.ports,
    async begin() {
      f.retire();
      return 'attempt';
    },
    async send() {
      sent++;
      return hashes[0];
    },
  });
  expect(result.status).toBe('retired');
  expect(sent).toBe(0);
  expect(f.events).toContain('not-broadcast');
});

it('retains a late acknowledged hash but does not start the next call after retirement', async () => {
  const f = fixture();
  let sent = 0;
  const result = await f.sequence.run({
    ...f.ports,
    async send() {
      sent++;
      f.retire();
      return hashes[0];
    },
  });
  expect(result.status).toBe('retired');
  expect(sent).toBe(1);
  expect(f.saved).toEqual([hashes[0]]);
});

it('requires explicit synchronous ownership and every side-effect port', async () => {
  const f = fixture();
  await expect(
    f.sequence.run({ ...f.ports, begin: undefined } as any)
  ).rejects.toThrow('explicit host ports');
  await expect(
    f.sequence.run({ ...f.ports, persistStopped: undefined } as any)
  ).rejects.toThrow('explicit host ports');
  await expect(
    f.sequence.run({ ...f.ports, assertCurrent: async () => undefined })
  ).rejects.toThrow('synchronous');
  expect(f.events).toEqual([]);
});

it('requires the fee-review port and never begins a cancelled review', async () => {
  const f = fixture();
  await expect(
    f.sequence.run({ ...f.ports, prepare: undefined } as any)
  ).rejects.toThrow('explicit host ports');
  const result = await f.sequence.run({
    ...f.ports,
    async prepare() {
      throw Object.assign(new Error('rejected'), { code: 4001 });
    },
  });
  expect(result).toMatchObject({
    status: 'finished',
    failed: true,
  });
  expect(f.events).not.toContain('begin');
  expect(f.progress.some((value) => value.failure?.kind === 'review')).toBe(
    true
  );
});

it('rejects a fee review for a changed execution before beginning an attempt', async () => {
  const f = fixture();
  const result = await f.sequence.run({
    ...f.ports,
    async prepare(transaction, index) {
      const review = await f.ports.prepare(transaction, index);
      return { ...review, transaction: { ...review.transaction, to: other } };
    },
  });
  expect(result).toMatchObject({ status: 'finished', failed: true });
  expect(f.events).not.toContain('begin');
});

it('re-reviews only the unsent suffix after another send claims a held call nonce', async () => {
  const f = fixture(),
    held = deferred();
  const reviewed: number[] = [];
  const attempted: number[] = [];
  let nextAvailable = 5,
    heldSecond = false;
  const ports: EoaCallsPorts = {
    ...f.ports,
    async nonce() {
      return Math.max(nextAvailable, 5 + f.saved.length);
    },
    async prepare(transaction, index) {
      reviewed.push(transaction.nonce);
      const review = await f.ports.prepare(transaction, index);
      if (index === 1 && !heldSecond) {
        heldSecond = true;
        await held.promise;
      }
      return review;
    },
    async send(review) {
      const nonce = Number(review.transaction.nonce);
      attempted.push(nonce);
      if (nonce < nextAvailable)
        throw Object.assign(new Error('nonce changed'), {
          transactionNotBroadcast: true,
        });
      return hashes[f.saved.length];
    },
  };
  const first = f.sequence.run(ports);
  while (!heldSecond) await Promise.resolve();
  expect(f.events.filter((value) => value === 'begin')).toHaveLength(1);
  expect(f.saved).toEqual([hashes[0]]);
  nextAvailable = 7;
  held.resolve();
  expect(await first).toMatchObject({ failed: true, hashes: [hashes[0]] });
  expect(await f.sequence.run(ports)).toMatchObject({
    failed: false,
    hashes: [hashes[1]],
  });
  expect(reviewed).toEqual([5, 6, 7]);
  expect(attempted).toEqual([5, 6, 7]);
  expect(f.saved).toEqual(hashes);
});

it('stops after a context-change error while retaining its acknowledged hash', async () => {
  const f = fixture();
  let calls = 0;
  const result = await f.sequence.run({
    ...f.ports,
    async send() {
      calls++;
      throw {
        message: 'PALI_TRANSACTION_CONTEXT_CHANGED',
        transactionHash: hashes[0],
      };
    },
  });
  expect(result).toMatchObject({
    status: 'finished',
    failed: true,
    hashes: [hashes[0]],
  });
  expect(calls).toBe(1);
});

it('snapshots host methods before an awaited begin', async () => {
  const f = fixture(),
    held = deferred();
  let entered = false;
  const ports = {
    ...f.ports,
    async begin() {
      entered = true;
      await held.promise;
      return 'attempt';
    },
  };
  const result = f.sequence.run(ports);
  while (!entered) await Promise.resolve();
  ports.send = async () => {
    throw new Error('replaced callback');
  };
  held.resolve();
  expect(await result).toMatchObject({
    status: 'finished',
    failed: false,
    hashes,
  });
});

it('preserves a creation call without inventing a destination or resolving a name', async () => {
  const f = fixture({
    version: '2.0.0',
    from,
    chainId: '1',
    calls: [{ data: '0x1234' }],
  });
  const resolveAddress = jest.fn(f.ports.resolveAddress);
  await f.sequence.run({ ...f.ports, resolveAddress });
  expect(resolveAddress).not.toHaveBeenCalled();
  expect(f.events).toContainEqual({
    transaction: {
      chainId: '1',
      from,
      to: null,
      value: '0',
      data: '0x1234',
      nonce: '5',
      type: 2,
      gasLimit: '65000',
      accessList: [],
      maxFeePerGas: '3',
      maxPriorityFeePerGas: '1',
    },
    submissionId: 'attempt',
  });
});

it('does not admit a concurrent run for the same reviewed sequence', async () => {
  const f = fixture(),
    held = deferred();
  let entered = false;
  const ports = {
    ...f.ports,
    async nonce() {
      entered = true;
      await held.promise;
      return 5;
    },
  };
  const first = f.sequence.run(ports);
  while (!entered) await Promise.resolve();
  await expect(f.sequence.run(ports)).rejects.toThrow('awaiting completion');
  held.resolve();
  await first;
  expect(f.events.filter((x) => x === 'begin')).toHaveLength(2);
});

it.each(['resolve', 'begin'])(
  'does not accept a transaction hash from %s before entering the sender',
  async (stage) => {
    const f = fixture({
      ...request,
      calls: [{ to: 'name.eth', value: '0x0', data: '0x' }],
    });
    const fail = async () => {
      throw Object.assign(new Error('metadata failed'), {
        transactionHash: hashes[0],
      });
    };
    const result = await f.sequence.run({
      ...f.ports,
      ...(stage === 'resolve' ? { resolveAddress: fail } : { begin: fail }),
    });
    expect(result).toMatchObject({
      status: 'finished',
      failed: true,
      hashes: [],
    });
    expect(f.saved).toEqual([]);
    expect(
      f.events.filter((x) => typeof x === 'object' && !Array.isArray(x))
    ).toHaveLength(0);
  }
);

it('an attempted local signed hash without a node acknowledgement stops as unknown', async () => {
  const f = fixture();
  const result = await f.sequence.run({
    ...f.ports,
    async send() {
      throw Object.assign(new Error('response lost'), {
        signedTransactionHash: hashes[0],
        transactionNotBroadcast: false,
      });
    },
  });
  expect(result).toMatchObject({ status: 'unknown', index: 0 });
  expect(f.saved).toEqual([]);
  expect(f.events.filter((value) => value === 'begin')).toHaveLength(1);
  await expect(f.sequence.run(f.ports)).rejects.toThrow('unresolved');
});
