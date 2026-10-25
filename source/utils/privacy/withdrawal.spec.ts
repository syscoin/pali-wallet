import { advanceMerkleWork, createMerkleWork, hashPair } from './merkle';
import { identifyClassicNote } from './note';
import { runPrivacyProof } from './prover';
import fixture from './prover.fixture.json';
import type { IPrivacyProofInput } from './proverTypes';
import { getPrivacyPool } from './registry';
import type { PrivacySnapshot } from './types';
import { preparePrivacyWithdrawal, provePrivacyWithdrawal } from './withdrawal';

jest.mock('./prover', () => ({ runPrivacyProof: jest.fn() }));
const word = (value: number) => `0x${value.toString(16).padStart(64, '0')}`;
const littleHex = (decimal: string) => {
  let value = BigInt(decimal),
    result = '';
  for (let i = 0; i < 31; i++) {
    result += Number(value & BigInt(255))
      .toString(16)
      .padStart(2, '0');
    value >>= BigInt(8);
  }
  return result;
};
const note = `tornado-eth-1-1-0x${littleHex(
  fixture.input.nullifier
)}${littleHex(fixture.input.secret)}`;
const identity = identifyClassicNote(note);
function snapshotAt(index = 0, count = 1): PrivacySnapshot {
  const leaves = Array.from({ length: count }, (_, i) => word(i + 1));
  leaves[index] = identity.commitment;
  const work = createMerkleWork();
  do {
    advanceMerkleWork(work, leaves, 128);
  } while (!work.complete);
  return {
    version: 1,
    chainId: 1,
    poolAddress: getPrivacyPool('eth-1').address,
    asOfBlockNumber: 20000000,
    asOfBlockHash: word(1000),
    leafCount: count,
    leaves,
    withdrawnNullifiers: [],
    root: work.root!,
  };
}
const request = (snapshot = snapshotAt()) => ({
  note,
  snapshot,
  recipient: fixture.input.recipient,
  relayer: fixture.input.relayer,
  fee: '0',
  refund: '0',
});
const guards = () => ({
  assertCurrent: jest.fn(),
  assertSnapshotCurrent: jest.fn(),
  yieldControl: async () => undefined,
});
const resultFor = (input: IPrivacyProofInput) => ({
  proof: `0x${'01'.repeat(256)}`,
  publicSignals: [
    input.root,
    input.nullifierHash,
    input.recipient,
    input.relayer,
    input.fee,
    input.refund,
  ].map((x) => BigInt(x).toString()),
});

it('reproduces canonical one-leaf witness and decodes both31-byte halves little-endian', async () => {
  const r = request(),
    options = guards();
  const input = await preparePrivacyWithdrawal(r, options);
  expect(input).toEqual(fixture.input);
  for (const call of options.assertSnapshotCurrent.mock.calls)
    expect(call[0]).toBe(r.snapshot);
});
it.each([0, 1, 2, 3, 4])(
  'builds exact depth20 path for leaf%s in an odd-sized tree',
  async (index) => {
    const r = request(snapshotAt(index, 5));
    const input = await preparePrivacyWithdrawal(r, guards());
    expect(input.pathElements).toHaveLength(20);
    expect(input.pathIndices).toHaveLength(20);
    expect(input.pathIndices).toEqual(
      Array.from({ length: 20 }, (_, l) => Math.floor(index / 2 ** l) % 2)
    );
    let root = identity.commitment;
    for (let level = 0; level < 20; level++)
      root = input.pathIndices[level]
        ? hashPair(input.pathElements[level], root)
        : hashPair(root, input.pathElements[level]);
    expect(root).toBe(r.snapshot.root);
  }
);
it('uses an independently checked cached path without rehashing the full pool', async () => {
  const r = request(snapshotAt(3, 5));
  const initial = await preparePrivacyWithdrawal(r, guards());
  const yieldControl = jest.fn();
  expect(
    await preparePrivacyWithdrawal(r, {
      ...guards(),
      yieldControl,
      cachedPath: initial,
    })
  ).toEqual(initial);
  expect(yieldControl).not.toHaveBeenCalled();
});
it('rejects a corrupted cached path or wrong index bits', async () => {
  const r = request(snapshotAt(3, 5));
  const initial = await preparePrivacyWithdrawal(r, guards());
  await expect(
    preparePrivacyWithdrawal(r, {
      ...guards(),
      cachedPath: {
        ...initial,
        pathElements: [word(500), ...initial.pathElements.slice(1)],
      },
    })
  ).rejects.toThrow('privacy_withdrawal_snapshot_invalid');
  await expect(
    preparePrivacyWithdrawal(r, {
      ...guards(),
      cachedPath: { ...initial, pathIndices: Array(20).fill(0) },
    })
  ).rejects.toThrow('privacy_withdrawal_snapshot_invalid');
});
it.each([
  { chainId: 2 },
  { poolAddress: getPrivacyPool('eth-10').address },
  { leafCount: 2 },
  { root: word(99) },
])('rejects inconsistent snapshot metadata %#', async (change) => {
  const r = request();
  r.snapshot = { ...r.snapshot, ...change };
  await expect(preparePrivacyWithdrawal(r, guards())).rejects.toThrow(
    'privacy_withdrawal_snapshot_invalid'
  );
});
it('rejects duplicate and absent commitments', async () => {
  const r = request(snapshotAt(0, 2));
  r.snapshot.leaves[1] = identity.commitment;
  await expect(preparePrivacyWithdrawal(r, guards())).rejects.toThrow(
    'privacy_withdrawal_snapshot_invalid'
  );
  const absent = request();
  absent.snapshot.leaves = [word(4)];
  await expect(preparePrivacyWithdrawal(absent, guards())).rejects.toThrow(
    'privacy_note_not_found'
  );
});
it('rejects a spent note from the locally supplied whole-pool feed', async () => {
  const r = request();
  r.snapshot.withdrawnNullifiers = [identity.nullifierHash];
  await expect(preparePrivacyWithdrawal(r, guards())).rejects.toThrow(
    'privacy_note_spent'
  );
});
it('requires the caller to authenticate original snapshot freshness', async () => {
  const options = guards();
  options.assertSnapshotCurrent.mockImplementation(() => {
    throw Error('stale');
  });
  await expect(preparePrivacyWithdrawal(request(), options)).rejects.toThrow(
    'privacy_verification_pending'
  );
  await expect(
    preparePrivacyWithdrawal(request(), {
      assertCurrent: () => undefined,
    } as any)
  ).rejects.toThrow('privacy_verification_pending');
});
it('bounds hash batches and rejects snapshot mutation while yielded', async () => {
  const r = request(snapshotAt(146, 257));
  const options = {
    ...guards(),
    yieldControl: jest.fn(async () => {
      r.snapshot.root = word(9);
    }),
  };
  await expect(preparePrivacyWithdrawal(r, options)).rejects.toThrow(
    'privacy_withdrawal_snapshot_invalid'
  );
  expect(options.yieldControl).toHaveBeenCalledTimes(1);
});
it('rejects a wallet change during path preparation', async () => {
  const r = request(snapshotAt(146, 257));
  let current = true;
  await expect(
    preparePrivacyWithdrawal(r, {
      ...guards(),
      assertCurrent: () => {
        if (!current) throw Error('changed');
      },
      yieldControl: async () => {
        current = false;
      },
    })
  ).rejects.toThrow('privacy_vault_session_changed');
});
it.each([
  {
    fee: '1000000000000000000',
    relayer: '0x2222222222222222222222222222222222222222',
  },
  { fee: '1' },
  { fee: '-1' },
  { fee: '01' },
  { fee: 1 },
  { refund: '1' },
  { recipient: '0x0000000000000000000000000000000000000000' },
  { recipient: 'bad' },
  { relayer: 'bad' },
])('rejects invalid recipient/fee/refund combination %#', async (change) => {
  await expect(
    preparePrivacyWithdrawal({ ...request(), ...change } as any, guards())
  ).rejects.toThrow('privacy_withdrawal_invalid');
});
it('permits an explicit positive fee to a nonzero relayer below the denomination', async () => {
  const input = await preparePrivacyWithdrawal(
    {
      ...request(),
      fee: '1',
      relayer: '0x2222222222222222222222222222222222222222',
    },
    guards()
  );
  expect(input.fee).toBe('1');
});
it('lazily invokes the local prover and clears its caller-owned secret fields afterwards', async () => {
  const proof = jest.mocked(runPrivacyProof);
  proof.mockImplementationOnce(async (input) => resultFor(input));
  const result = await provePrivacyWithdrawal(request(), guards());
  expect(result.proof).toHaveLength(514);
  const input = proof.mock.calls[0][0];
  expect(input.secret).toBe('');
  expect(input.nullifier).toBe('');
});
it('rejects a stale result and a newly spent local note after proving', async () => {
  const r = request();
  const options = guards();
  let current = true;
  await expect(
    provePrivacyWithdrawal(r, {
      ...options,
      assertCurrent: () => {
        if (!current) throw Error('changed');
      },
      runProof: async (input) => {
        current = false;
        return resultFor(input);
      },
    })
  ).rejects.toThrow('privacy_vault_session_changed');
  await expect(
    provePrivacyWithdrawal(request(), {
      ...guards(),
      runProof: async () => {
        throw Error(note);
      },
    })
  ).rejects.toThrow(/^privacy_withdrawal_invalid$/);
  const spent = request();
  await expect(
    provePrivacyWithdrawal(spent, {
      ...guards(),
      runProof: async (input) => {
        spent.snapshot.withdrawnNullifiers.push(input.nullifierHash);
        return resultFor(input);
      },
    })
  ).rejects.toThrow('privacy_note_spent');
});
it('never fetches and rejects changed proof public signals', async () => {
  const fetch = jest
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(Error('network prohibited'));
  try {
    await expect(
      provePrivacyWithdrawal(request(), {
        ...guards(),
        runProof: async (input) => ({
          ...resultFor(input),
          publicSignals: Array(6).fill('0'),
        }),
      })
    ).rejects.toThrow('privacy_proof_failed');
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});

it('rejects asynchronous or boolean snapshot guards instead of treating flags as trust', async () => {
  await expect(
    preparePrivacyWithdrawal(request(), {
      ...guards(),
      assertSnapshotCurrent: (() => Promise.resolve()) as any,
    })
  ).rejects.toThrow('privacy_verification_pending');
  await expect(
    preparePrivacyWithdrawal(request(), {
      ...guards(),
      assertSnapshotCurrent: (() => true) as any,
    })
  ).rejects.toThrow('privacy_verification_pending');
});
it('keeps the trust guard tied to the original object if the request snapshot is replaced', async () => {
  const r = request(snapshotAt(146, 257)),
    original = r.snapshot;
  const options = guards();
  options.yieldControl = async () => {
    r.snapshot = { ...original };
  };
  await expect(preparePrivacyWithdrawal(r, options)).rejects.toThrow(
    'privacy_withdrawal_snapshot_invalid'
  );
  for (const call of options.assertSnapshotCurrent.mock.calls)
    expect(call[0]).toBe(original);
});

it('rejects sparse proof replies and aborts before local work', async () => {
  await expect(
    provePrivacyWithdrawal(request(), {
      ...guards(),
      runProof: async (input) => ({
        ...resultFor(input),
        publicSignals: Array(6),
      }),
    })
  ).rejects.toThrow('privacy_proof_failed');
  const abort = new AbortController();
  abort.abort();
  const options = guards();
  await expect(
    preparePrivacyWithdrawal(request(), { ...options, signal: abort.signal })
  ).rejects.toThrow('privacy_proof_cancelled');
  expect(options.assertSnapshotCurrent).not.toHaveBeenCalled();
});
