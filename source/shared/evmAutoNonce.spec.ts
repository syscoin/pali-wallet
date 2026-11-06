import { EvmAutoNonceAcceptance, planEvmAutoNonce } from './evmAutoNonce';

type Input = Parameters<typeof planEvmAutoNonce>[0];
type Retained = Input['retained'][number];
type Accepted = Input['accepted'][number];
const scope = {
  chainId: '57',
  from: `0x${'ab'.repeat(20)}`,
  endpoint: 'configured-endpoint',
};
const record = (
  nonce: number,
  phase: Retained['phase'] = 'signed'
): Retained => ({
  chainId: scope.chainId,
  from: scope.from,
  hash: `0x${nonce.toString(16).padStart(64, '0')}`,
  nonce,
  phase,
});
const proof = (
  { chainId, from, hash, nonce }: Retained,
  source: Accepted['source'] = 'acknowledged'
): Accepted => ({
  chainId,
  from,
  hash,
  nonce,
  endpoint: scope.endpoint,
  source,
});

const plan = (overrides: Partial<Input> = {}) =>
  planEvmAutoNonce({
    ...scope,
    latest: 10,
    pending: 10,
    retained: [],
    accepted: [],
    ...overrides,
  });

it('uses the greater endpoint count and keeps nonce zero valid', () => {
  expect(plan({ latest: 0, pending: 0 })).toEqual({ kind: 'ready', nonce: 0 });
  expect(plan({ latest: 11, pending: 10 })).toEqual({
    kind: 'ready',
    nonce: 11,
  });
  expect(plan({ latest: 10, pending: 12 })).toEqual({
    kind: 'ready',
    nonce: 12,
  });
});

it('advances only contiguous accepted retained nonces despite a lagging RPC', () => {
  const records = [
    record(10),
    record(11, 'attempted'),
    record(13, 'submitted'),
  ];
  const accepted = [
    proof(records[0]!),
    proof(records[1]!, 'observed-pending'),
    proof(records[2]!),
  ];
  expect(plan({ retained: records, accepted })).toEqual({
    kind: 'ready',
    nonce: 12,
  });
  expect(plan({ pending: 11, retained: records, accepted })).toEqual({
    kind: 'ready',
    nonce: 12,
  });
});

it.each([
  'signed',
  'attempted',
  'submitted',
  'confirmed',
  'reverted',
  'nonce-consumed',
] as const)(
  'does not treat the persisted %s phase alone as evidence',
  (phase) => {
    const retained = [record(10, phase), record(11)];
    const accepted = [proof(retained[1]!)];
    expect(plan({ retained, accepted })).toEqual({
      kind: 'unresolved',
      nonce: 10,
    });
    expect(plan({ pending: 11, retained, accepted })).toEqual({
      kind: 'ready',
      nonce: 12,
    });
  }
);

it('does not let stale acceptance of a terminal record advance a reorg gap', () => {
  const retained = [record(10, 'nonce-consumed')];
  expect(plan({ retained, accepted: [proof(retained[0]!)] })).toEqual({
    kind: 'unresolved',
    nonce: 10,
  });
});

it('uses only exact chain, sender, endpoint, nonce and hash evidence', () => {
  const owner = record(10);
  const accepted = proof(owner);
  for (const other of [
    { chainId: '1' },
    { from: `0x${'cd'.repeat(20)}` },
    { endpoint: 'different-endpoint' },
    { nonce: 11 },
    { hash: record(11).hash },
  ]) {
    expect(
      plan({ retained: [owner], accepted: [{ ...accepted, ...other }] })
    ).toEqual({ kind: 'unresolved', nonce: 10 });
  }
  expect(plan({ retained: [], accepted: [accepted] })).toEqual({
    kind: 'ready',
    nonce: 10,
  });
  expect(plan({ retained: [{ ...owner, chainId: '1' }] })).toEqual({
    kind: 'ready',
    nonce: 10,
  });
});

it('counts one accepted variant at a nonce without skipping the next unresolved record', () => {
  const first = record(10, 'submitted');
  const sibling = { ...record(10, 'signed'), hash: record(20).hash };
  const next = record(11, 'attempted');
  expect(
    plan({ retained: [first, sibling, next], accepted: [proof(first)] })
  ).toEqual({ kind: 'unresolved', nonce: 11 });
});

it('rejects invalid endpoint counts and an advancing nonce outside the SDK range', () => {
  expect(() => plan({ latest: -1 })).toThrow('Invalid EVM nonce counts');
  expect(() => plan({ pending: 1.5 })).toThrow('Invalid EVM nonce counts');
  const limit = record(Number.MAX_SAFE_INTEGER);
  expect(() =>
    plan({
      latest: limit.nonce,
      pending: limit.nonce,
      retained: [limit],
      accepted: [proof(limit)],
    })
  ).toThrow('EVM nonce exceeds safe range');
});

function acceptanceFixture(
  retained: readonly Retained[],
  readPending = jest.fn()
) {
  let now = 0;
  const acceptance = new EvmAutoNonceAcceptance(() => now);
  const snapshot = {
    owner: 'authenticated owner',
    retained,
    readMaximumCost: jest.fn().mockResolvedValue(BigInt(10)),
  };
  const input = {
    ...scope,
    latest: 0,
    pending: 0,
    snapshot,
    readPending,
    assertCurrent: jest.fn(),
  };
  const select = (overrides: Partial<typeof input> = {}) =>
    acceptance.plan({ ...input, ...overrides });
  return {
    acceptance,
    snapshot,
    select,
    readPending,
    advance: () => {
      now += 30_001;
    },
  };
}

const pendingResponse = (entry: Retained) => ({
  chainId: '0x39',
  from: entry.from,
  hash: entry.hash,
  nonce: `0x${entry.nonce.toString(16)}`,
  blockHash: null,
  blockNumber: null,
  transactionIndex: null,
});

it('uses a fulfilled exact ACK with stale RPC counts and reserves the maximum authenticated alternative', async () => {
  const first = record(0);
  const sibling = { ...first, hash: record(11).hash };
  const fixture = acceptanceFixture([first, sibling]);
  const complete = fixture.acceptance.track(
    fixture.snapshot.owner,
    scope.endpoint,
    first
  );
  expect(await fixture.select()).toEqual({ kind: 'unresolved', nonce: 0 });
  expect(fixture.snapshot.readMaximumCost).not.toHaveBeenCalled();
  fixture.readPending.mockClear();
  fixture.snapshot.readMaximumCost
    .mockResolvedValueOnce(BigInt(10))
    .mockResolvedValueOnce(BigInt(30));
  complete(first.hash);
  expect(await fixture.select()).toEqual({
    kind: 'ready',
    nonce: 1,
    maximumPredecessorCost: BigInt(30),
  });
  expect(fixture.readPending).not.toHaveBeenCalled();
  fixture.snapshot.readMaximumCost.mockClear();
  expect(await fixture.select({ pending: 1 })).toEqual({
    kind: 'ready',
    nonce: 1,
    maximumPredecessorCost: BigInt(0),
  });
  expect(fixture.snapshot.readMaximumCost).not.toHaveBeenCalled();
});

it('requires exact pending observation after acknowledgement expiry or owner/route change', async () => {
  const first = record(0);
  const fixture = acceptanceFixture([first]);
  fixture.acceptance.track(
    fixture.snapshot.owner,
    scope.endpoint,
    first
  )(first.hash);
  for (const context of [
    { snapshot: { ...fixture.snapshot, owner: 'other owner' } },
    { endpoint: 'other route' },
  ]) {
    expect(await fixture.select(context)).toEqual({
      kind: 'unresolved',
      nonce: 0,
    });
  }
  fixture.advance();
  for (const mismatch of [
    { chainId: '0x1' },
    { hash: record(1).hash },
    { nonce: '0x1' },
    { from: `0x${'cd'.repeat(20)}` },
    { blockHash: record(1).hash },
    { blockNumber: '0x1' },
    { transactionIndex: '0x0' },
  ]) {
    fixture.readPending.mockResolvedValue({
      ...pendingResponse(first),
      ...mismatch,
    });
    expect(await fixture.select()).toEqual({ kind: 'unresolved', nonce: 0 });
  }
  fixture.readPending.mockResolvedValue(pendingResponse(first));
  expect(await fixture.select()).toEqual({
    kind: 'ready',
    nonce: 1,
    maximumPredecessorCost: BigInt(10),
  });
});

it('does not revive a retired acknowledgement that resolves after inclusion', async () => {
  const first = record(0);
  const fixture = acceptanceFixture([first]);
  const complete = fixture.acceptance.track(
    fixture.snapshot.owner,
    scope.endpoint,
    first
  );
  fixture.acceptance.retireNonce(fixture.snapshot.owner, first);
  complete(first.hash);
  expect(await fixture.select()).toEqual({ kind: 'unresolved', nonce: 0 });
  expect(fixture.readPending).toHaveBeenCalledWith(first.hash);
});

it('bounds missing-ACK queries and never jumps over a gap', async () => {
  const fixture = acceptanceFixture(
    Array.from({ length: 100 }, (_, nonce) => record(nonce)),
    jest
      .fn()
      .mockImplementation(async (hash: string) =>
        pendingResponse(record(Number(BigInt(hash))))
      )
  );
  expect(await fixture.select()).toEqual({ kind: 'unresolved', nonce: 16 });
  expect(fixture.readPending).toHaveBeenCalledTimes(16);
  const gap = acceptanceFixture([record(3)]);
  expect(await gap.select()).toEqual({
    kind: 'ready',
    nonce: 0,
    maximumPredecessorCost: BigInt(0),
  });
  expect(gap.readPending).not.toHaveBeenCalled();
});

it('waits for a caught-up RPC before reviewing another call to the same asset', async () => {
  const predecessor = record(0);
  const fixture = acceptanceFixture([predecessor]);
  fixture.acceptance.track(
    fixture.snapshot.owner,
    scope.endpoint,
    predecessor
  )(predecessor.hash);
  const asset = '0x' + 'ef'.repeat(20);
  const touchesContract = jest.fn().mockResolvedValue(true);
  const snapshot = { ...fixture.snapshot, touchesContract };
  const read = {
    snapshot,
    protectedAssetContract: asset,
  };
  expect(await fixture.select(read)).toEqual({
    kind: 'unresolved',
    nonce: 0,
    reason: 'asset-state',
  });
  expect(touchesContract).toHaveBeenCalledWith(predecessor.hash, asset);
  touchesContract.mockClear();
  expect(await fixture.select({ ...read, pending: 1 })).toEqual({
    kind: 'ready',
    nonce: 1,
    maximumPredecessorCost: BigInt(0),
  });
  expect(touchesContract).not.toHaveBeenCalled();
});

it('rechecks acknowledgement freshness after asynchronous budget reads', async () => {
  const predecessor = record(0);
  const fixture = acceptanceFixture([predecessor]);
  fixture.acceptance.track(
    fixture.snapshot.owner,
    scope.endpoint,
    predecessor
  )(predecessor.hash);
  fixture.snapshot.readMaximumCost.mockImplementationOnce(async () => {
    fixture.advance();
    return BigInt(10);
  });
  expect(await fixture.select()).toEqual({ kind: 'unresolved', nonce: 0 });
});
