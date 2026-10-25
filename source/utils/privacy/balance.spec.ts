import { verifiedNoteBalance } from './balance';
import type { IPrivateNoteView } from './privateVaultTypes';
import { PRIVACY_POOLS } from './registry';

it.each(PRIVACY_POOLS)('uses the pinned denomination for $id', (pool) => {
  expect(verifiedNoteBalance([{ poolId: pool.id, phase: 'verified' }])).toBe(
    pool.amount
  );
});

it('sums tenths exactly and formats integer totals without a decimal tail', () => {
  const tenth = { poolId: 'eth-0.1', phase: 'verified' } as const;
  expect(verifiedNoteBalance([tenth, tenth, tenth])).toBe('0.3');
  expect(verifiedNoteBalance(Array(10).fill(tenth))).toBe('1');
  expect(
    verifiedNoteBalance(
      PRIVACY_POOLS.map(({ id: poolId }) => ({ poolId, phase: 'verified' }))
    )
  ).toBe('111.1');
  expect(
    verifiedNoteBalance(
      Array(128).fill({ poolId: 'eth-100', phase: 'verified' })
    )
  ).toBe('12800');
});

it('excludes every non-verified phase and does not trust response amounts', () => {
  const ignored = ['prepared', 'spent', 'waiting', 'not-found'].map(
    (phase) => ({ poolId: 'eth-100', phase })
  ) as Pick<IPrivateNoteView, 'phase' | 'poolId'>[];
  expect(verifiedNoteBalance(ignored)).toBe('0');
  const claimed = {
    poolId: 'eth-0.1',
    phase: 'verified',
    amount: '999',
  } as const;
  expect(verifiedNoteBalance([...ignored, claimed])).toBe('0.1');
  expect(verifiedNoteBalance([])).toBe('0');
});
