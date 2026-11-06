import { planEvmAutoNonce } from './evmAutoNonce';

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
