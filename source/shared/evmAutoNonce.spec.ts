import type { EvmAssetState } from './evmAssetState';
import {
  assertEvmAssetReservations,
  EvmAutoNonceAcceptance,
  planEvmAutoNonce,
} from './evmAutoNonce';

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
    readAssetDebit: jest.fn().mockResolvedValue(BigInt(0)),
  };
  const input = {
    ...scope,
    latest: 0,
    pending: 0,
    snapshot,
    readPending,
    assertCurrent: jest.fn(),
  };
  const select = (
    overrides: Partial<Parameters<EvmAutoNonceAcceptance['plan']>[0]> = {}
  ) => acceptance.plan({ ...input, ...overrides });
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
    additionalNativeCost: BigInt(30),
  });
  expect(fixture.readPending).not.toHaveBeenCalled();
  fixture.snapshot.readMaximumCost.mockClear();
  expect(await fixture.select({ pending: 1 })).toEqual({
    kind: 'ready',
    nonce: 1,
    additionalNativeCost: BigInt(0),
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
    additionalNativeCost: BigInt(10),
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
    additionalNativeCost: BigInt(10),
  });
  expect(gap.readPending).not.toHaveBeenCalled();
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

const assetState = (
  amountUnits = '60',
  balanceUnits = BigInt(100)
): EvmAssetState => ({
  from: scope.from,
  asset: {
    standard: 'ERC20',
    contractAddress: '0x' + 'ef'.repeat(20),
    amountUnits,
  },
  number: '0x8',
  hash: '0x' + 'aa'.repeat(32),
  nonce: 0,
  balanceUnits,
});
it('allows an asset send behind external pending transactions', async () => {
  const fixture = acceptanceFixture([]);
  expect(
    await fixture.select({ assetState: assetState(), pending: 1 })
  ).toEqual({
    kind: 'ready',
    nonce: 1,
    additionalNativeCost: BigInt(0),
  });
});
it.each(['acknowledged', 'observed-pending'] as const)(
  'queues an affordable asset transfer behind a %s predecessor with lagging RPC counts',
  async (source) => {
    const predecessor = record(0, 'submitted');
    const fixture = acceptanceFixture([predecessor]);
    fixture.snapshot.readAssetDebit.mockResolvedValue(BigInt(30));
    if (source === 'acknowledged')
      fixture.acceptance.track(
        fixture.snapshot.owner,
        scope.endpoint,
        predecessor
      )(predecessor.hash);
    else fixture.readPending.mockResolvedValue(pendingResponse(predecessor));
    expect(await fixture.select({ assetState: assetState() })).toEqual({
      kind: 'ready',
      nonce: 1,
      additionalNativeCost: BigInt(10),
    });
    await expect(
      fixture.select({ assetState: assetState('80') })
    ).rejects.toMatchObject({
      code: 'INSUFFICIENT_ASSET',
    });
  }
);
it('reserves the maximum same-nonce sibling debit once and sums separate nonces', async () => {
  const first = record(0),
    sibling = { ...first, hash: record(9).hash },
    second = record(1);
  const fixture = acceptanceFixture([first, sibling, second]);
  fixture.snapshot.readAssetDebit.mockImplementation(async (hash: string) =>
    hash === first.hash
      ? BigInt(30)
      : hash === sibling.hash
      ? BigInt(45)
      : BigInt(10)
  );
  await expect(
    fixture.select({ pending: 2, assetState: assetState('40') })
  ).resolves.toMatchObject({ nonce: 2 });
  await expect(
    fixture.select({ pending: 2, assetState: assetState('50') })
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_ASSET' });
});
it('does not reserve predecessors already included in the canonical balance', async () => {
  const fixture = acceptanceFixture([record(0, 'confirmed')]);
  fixture.snapshot.readAssetDebit.mockResolvedValue(BigInt(30));
  const state = { ...assetState('60', BigInt(70)), nonce: 1 };
  expect(
    await fixture.select({ latest: 1, pending: 1, assetState: state })
  ).toMatchObject({ kind: 'ready', nonce: 1 });
  expect(fixture.snapshot.readAssetDebit).not.toHaveBeenCalled();
});
it('does not reserve another chain or sender through the shared planner', async () => {
  const fixture = acceptanceFixture([
    { ...record(0), chainId: '1' },
    { ...record(0), from: '0x' + 'cd'.repeat(20) },
  ]);
  fixture.snapshot.readAssetDebit.mockResolvedValue(BigInt(100));
  expect(
    await fixture.select({ pending: 1, assetState: assetState() })
  ).toMatchObject({ kind: 'ready', nonce: 1 });
  expect(fixture.snapshot.readAssetDebit).not.toHaveBeenCalled();
});
it('revalidates a manual nonce and checks its asset predecessors without forcing the automatic nonce', async () => {
  const fixture = acceptanceFixture([record(0)]);
  fixture.snapshot.readAssetDebit.mockResolvedValue(BigInt(30));
  expect(
    await fixture.select({
      pending: 2,
      nonceOverride: 1,
      assetState: assetState(),
    })
  ).toMatchObject({ kind: 'ready', nonce: 1 });
  expect(
    await fixture.select({
      pending: 2,
      nonceOverride: 0,
      assetState: assetState(),
    })
  ).toEqual({ kind: 'unresolved', nonce: 0 });
  await expect(
    fixture.select({ latest: 1, nonceOverride: 0 })
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
it('fails on invalid or unauthenticated debit reads and revocation during a read', async () => {
  const fixture = acceptanceFixture([record(0)]);
  fixture.snapshot.readAssetDebit.mockResolvedValue(BigInt(-1));
  await expect(
    fixture.select({ pending: 1, assetState: assetState() })
  ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  fixture.snapshot.readAssetDebit.mockRejectedValue(
    new Error('corrupt journal')
  );
  await expect(
    fixture.select({ pending: 1, assetState: assetState() })
  ).rejects.toThrow('corrupt journal');
  let current = true;
  fixture.snapshot.readAssetDebit.mockImplementation(async () => {
    current = false;
    return BigInt(0);
  });
  await expect(
    fixture.select({
      pending: 1,
      assetState: assetState(),
      assertCurrent() {
        if (!current) throw new Error('revoked');
      },
    })
  ).rejects.toThrow('revoked');
});
it('counts a reorged terminal record while its nonce is again after the balance basis', async () => {
  const fixture = acceptanceFixture([record(0, 'confirmed')]);
  fixture.snapshot.readAssetDebit.mockResolvedValue(BigInt(50));
  await expect(
    fixture.select({ pending: 1, assetState: assetState() })
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_ASSET' });
});
it('rejects a stale asset basis but does not equate selected nonce with basis nonce', async () => {
  const fixture = acceptanceFixture([]);
  expect(
    await fixture.select({ latest: 1, pending: 1, assetState: assetState() })
  ).toMatchObject({ kind: 'unresolved', reason: 'asset-state' });
  expect(
    await fixture.select({ latest: 0, pending: 3, assetState: assetState() })
  ).toMatchObject({ kind: 'ready', nonce: 3 });
});
it('provides the same reservation check for an already selected nonce', async () => {
  const fixture = acceptanceFixture([record(0)]);
  fixture.snapshot.readAssetDebit.mockResolvedValue(BigInt(30));
  await expect(
    assertEvmAssetReservations(
      assetState('80'),
      1,
      fixture.snapshot,
      () => undefined
    )
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_ASSET' });
});

it('rechecks acknowledgement expiry after asynchronous asset debit reads', async () => {
  const first = record(0);
  const fixture = acceptanceFixture([first]);
  fixture.acceptance.track(
    fixture.snapshot.owner,
    scope.endpoint,
    first
  )(first.hash);
  fixture.snapshot.readAssetDebit.mockImplementationOnce(async () => {
    fixture.advance();
    return BigInt(1);
  });
  expect(await fixture.select({ assetState: assetState() })).toEqual({
    kind: 'unresolved',
    nonce: 0,
  });
});
it('uses a captured balance while debit reads are pending', async () => {
  const fixture = acceptanceFixture([record(0)]);
  const state = assetState('80');
  fixture.snapshot.readAssetDebit.mockImplementation(async () => {
    (state as { balanceUnits: bigint }).balanceUnits = BigInt(1000);
    return BigInt(30);
  });
  await expect(
    fixture.select({ pending: 1, assetState: state })
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_ASSET' });
});

it('reserves a future nonce while filling an earlier gap', async () => {
  const future = record(1, 'submitted');
  const fixture = acceptanceFixture([future]);
  fixture.snapshot.readAssetDebit.mockResolvedValue(BigInt(7));
  await expect(
    fixture.select({ assetState: assetState('6', BigInt(10)) })
  ).rejects.toMatchObject({
    code: 'INSUFFICIENT_ASSET',
  });
  expect(
    await fixture.select({ assetState: assetState('3', BigInt(10)) })
  ).toMatchObject({ kind: 'ready', nonce: 0 });
  expect(fixture.snapshot.readAssetDebit).toHaveBeenCalledWith(
    future.hash,
    expect.objectContaining({ standard: 'ERC20', amountUnits: '3' })
  );
  expect(fixture.readPending).not.toHaveBeenCalled();
});
it('reserves acknowledged and future groups even below the RPC pending count', async () => {
  const first = record(0, 'submitted'),
    future = record(3);
  const fixture = acceptanceFixture([first, future]);
  fixture.snapshot.readAssetDebit.mockResolvedValue(BigInt(4));
  await expect(
    fixture.select({ pending: 2, assetState: assetState('3', BigInt(10)) })
  ).rejects.toMatchObject({
    code: 'INSUFFICIENT_ASSET',
  });
  expect(
    await fixture.select({
      pending: 2,
      assetState: assetState('2', BigInt(10)),
    })
  ).toMatchObject({ kind: 'ready', nonce: 2 });
});
it('counts a persisted candidate once and takes the maximum candidate-nonce alternative', async () => {
  const candidate = record(2),
    alternative = { ...candidate, hash: record(8).hash },
    future = record(4);
  const fixture = acceptanceFixture([candidate, alternative, future]);
  fixture.snapshot.readAssetDebit.mockImplementation(async (hash: string) =>
    hash === candidate.hash
      ? BigInt(6)
      : hash === alternative.hash
      ? BigInt(7)
      : BigInt(3)
  );
  await expect(
    assertEvmAssetReservations(
      assetState('6', BigInt(10)),
      2,
      fixture.snapshot,
      () => undefined
    )
  ).resolves.toBeUndefined();
  await expect(
    assertEvmAssetReservations(
      assetState('8', BigInt(10)),
      2,
      fixture.snapshot,
      () => undefined
    )
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_ASSET' });
});
it('applies the same full reservation horizon to manual nonce selection', async () => {
  const fixture = acceptanceFixture([record(4)]);
  fixture.snapshot.readAssetDebit.mockResolvedValue(BigInt(7));
  await expect(
    fixture.select({
      nonceOverride: 2,
      assetState: assetState('6', BigInt(10)),
    })
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_ASSET' });
  expect(
    await fixture.select({
      nonceOverride: 2,
      assetState: assetState('3', BigInt(10)),
    })
  ).toMatchObject({ kind: 'ready', nonce: 2 });
});
it('prevents promising the same ERC721 in an independent future nonce group', async () => {
  const fixture = acceptanceFixture([record(3)]);
  const selected = {
    ...assetState('1', BigInt(1)),
    asset: {
      standard: 'ERC721' as const,
      contractAddress: '0x' + 'ef'.repeat(20),
      amountUnits: '1',
      tokenId: '7',
    },
  };
  fixture.snapshot.readAssetDebit.mockImplementation(
    async (_hash: string, asset) =>
      asset.tokenId === '7' ? BigInt(1) : BigInt(0)
  );
  await expect(fixture.select({ assetState: selected })).rejects.toMatchObject({
    code: 'INSUFFICIENT_ASSET',
  });
  expect(
    await fixture.select({
      assetState: { ...selected, asset: { ...selected.asset, tokenId: '8' } },
    })
  ).toMatchObject({ kind: 'ready', nonce: 0 });
});
it('does not double-count the same ERC721 candidate persisted at its selected nonce', async () => {
  const fixture = acceptanceFixture([record(0)]);
  fixture.snapshot.readAssetDebit.mockResolvedValue(BigInt(1));
  const selected = {
    ...assetState('1', BigInt(1)),
    asset: {
      standard: 'ERC721' as const,
      contractAddress: '0x' + 'ef'.repeat(20),
      amountUnits: '1',
      tokenId: '7',
    },
  };
  await expect(
    assertEvmAssetReservations(selected, 0, fixture.snapshot, () => undefined)
  ).resolves.toBeUndefined();
});
it('keeps cancellation currentness checks when a future reservation read finishes', async () => {
  const fixture = acceptanceFixture([record(5)]);
  let current = true;
  fixture.snapshot.readAssetDebit.mockImplementation(async () => {
    current = false;
    return BigInt(7);
  });
  await expect(
    fixture.select({
      assetState: assetState('3', BigInt(10)),
      assertCurrent() {
        if (!current) throw new Error('future read cancelled');
      },
    })
  ).rejects.toThrow('future read cancelled');
});
it('stops decoding additional future records once the known reservation exceeds the balance', async () => {
  const fixture = acceptanceFixture([record(2), record(3), record(4)]);
  fixture.snapshot.readAssetDebit.mockResolvedValue(BigInt(7));
  await expect(
    fixture.select({ assetState: assetState('6', BigInt(10)) })
  ).rejects.toMatchObject({ code: 'INSUFFICIENT_ASSET' });
  expect(fixture.snapshot.readAssetDebit).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  'budgets a future native commitment while filling a gap, manual=%s',
  async (manual) => {
    const fixture = acceptanceFixture([record(1)]);
    fixture.snapshot.readMaximumCost.mockResolvedValue(BigInt(7));
    const result = await fixture.select(manual ? { nonceOverride: 0 } : {});
    expect(result).toMatchObject({
      kind: 'ready',
      nonce: 0,
      additionalNativeCost: BigInt(7),
    });
    if (result.kind === 'ready')
      expect(BigInt(10) - result.additionalNativeCost < BigInt(6)).toBe(true);
  }
);
it('does not subtract a native pending prefix already represented by the RPC balance', async () => {
  const first = record(0, 'submitted'),
    future = record(3);
  const fixture = acceptanceFixture([first, future]);
  fixture.snapshot.readMaximumCost.mockImplementation(async (hash: string) =>
    hash === first.hash ? BigInt(7) : BigInt(2)
  );
  expect(await fixture.select({ pending: 1 })).toMatchObject({
    kind: 'ready',
    nonce: 1,
    additionalNativeCost: BigInt(2),
  });
  expect(fixture.snapshot.readMaximumCost).toHaveBeenCalledTimes(1);
  expect(fixture.snapshot.readMaximumCost).toHaveBeenCalledWith(future.hash);
});
it('manual replacement below RPC pending reserves native costs from the latest balance basis', async () => {
  const first = record(0),
    future = record(3);
  const fixture = acceptanceFixture([first, future]);
  fixture.snapshot.readMaximumCost.mockImplementation(async (hash: string) =>
    hash === first.hash ? BigInt(7) : BigInt(2)
  );
  expect(await fixture.select({ pending: 2, nonceOverride: 1 })).toMatchObject({
    kind: 'ready',
    nonce: 1,
    additionalNativeCost: BigInt(9),
  });
});
it('native replacement alternatives reserve the maximum cost once', async () => {
  const first = record(2),
    sibling = { ...first, hash: record(9).hash };
  const fixture = acceptanceFixture([first, sibling, record(4)]);
  fixture.snapshot.readMaximumCost.mockImplementation(async (hash: string) =>
    hash === first.hash
      ? BigInt(7)
      : hash === sibling.hash
      ? BigInt(5)
      : BigInt(2)
  );
  expect(await fixture.select()).toMatchObject({
    kind: 'ready',
    nonce: 0,
    additionalNativeCost: BigInt(9),
  });
});
it('native reservation rejects invalid costs and retains cancellation after a future read', async () => {
  const fixture = acceptanceFixture([record(2)]);
  fixture.snapshot.readMaximumCost.mockResolvedValue(BigInt(-1));
  await expect(fixture.select()).rejects.toThrow('Invalid retained EVM cost');
  let current = true;
  fixture.snapshot.readMaximumCost.mockImplementation(async () => {
    current = false;
    return BigInt(7);
  });
  await expect(
    fixture.select({
      assertCurrent() {
        if (!current) throw new Error('cancelled native budget');
      },
    })
  ).rejects.toThrow('cancelled native budget');
});
it('native reserve work remains local and includes more than sixteen queued future commitments', async () => {
  const fixture = acceptanceFixture(
    Array.from({ length: 20 }, (_, index) => record(index + 2))
  );
  fixture.snapshot.readMaximumCost.mockResolvedValue(BigInt(1));
  expect(await fixture.select()).toMatchObject({
    kind: 'ready',
    nonce: 0,
    additionalNativeCost: BigInt(20),
  });
  expect(fixture.readPending).not.toHaveBeenCalled();
  expect(fixture.snapshot.readMaximumCost).toHaveBeenCalledTimes(20);
});

it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])(
  'rejects an invalid future nonce %s before reserving its cost',
  async (nonce) => {
    const fixture = acceptanceFixture([{ ...record(2), nonce }]);
    await expect(fixture.select()).rejects.toThrow(
      'Invalid retained EVM nonce'
    );
    expect(fixture.snapshot.readMaximumCost).not.toHaveBeenCalled();
  }
);
