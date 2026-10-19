import { selectEnsNameToAddress } from '../vault/selectors';

import reducer, { ENS_CACHE_TTL_MS, rehydrate, setEnsName } from './index';

const A = `0x${'11'.repeat(20)}`;
const B = `0x${'22'.repeat(20)}`;
const C = `0x${'33'.repeat(20)}`;

it('replaces older case-insensitive entries for a name without removing other names', () => {
  const now = Date.now();
  const initial = {
    ...reducer(undefined, { type: 'test/init' }),
    ensCache: {
      [A]: { name: 'Receiver.eth', timestamp: now },
      [B]: { name: 'receiver.eth', timestamp: now },
      [C]: { name: 'different.eth', timestamp: now },
    },
  };
  const next = reducer(
    initial,
    setEnsName({ address: A, name: 'RECEIVER.ETH' })
  );
  expect(next.ensCache[B]).toBeUndefined();
  expect(next.ensCache[C]).toEqual(initial.ensCache[C]);
  expect(selectEnsNameToAddress({ vaultGlobal: next } as any)).toEqual({
    'receiver.eth': A,
    'different.eth': C,
  });
  expect(Object.keys(initial.ensCache)).toHaveLength(3);
});

it('retains expiry cleanup while replacing a name mapping', () => {
  const initial = {
    ...reducer(undefined, { type: 'test/init' }),
    ensCache: {
      [A]: { name: 'receiver.eth', timestamp: Date.now() },
      [B]: {
        name: 'expired.eth',
        timestamp: Date.now() - ENS_CACHE_TTL_MS - 1,
      },
    },
  };
  const next = reducer(
    initial,
    setEnsName({ address: C, name: 'receiver.eth' })
  );
  expect(Object.keys(next.ensCache)).toEqual([C]);
  expect(
    selectEnsNameToAddress({ vaultGlobal: next } as any)['receiver.eth']
  ).toBe(C);
});

it.each(['missing-name', 'numeric-name', 'null-entry'])(
  'discards a hydrated %s while publishing a healthy mapping',
  (shape) => {
    const now = Date.now();
    const malformed =
      shape === 'missing-name'
        ? { timestamp: now }
        : shape === 'numeric-name'
        ? { name: 123, timestamp: now }
        : null;
    const hydrated = reducer(
      undefined,
      rehydrate({
        ...reducer(undefined, { type: 'test/init' }),
        ensCache: {
          [A]: malformed,
          [B]: { name: 'healthy.eth', timestamp: now },
        },
      } as any)
    );
    expect(hydrated.ensCache[A]).toEqual(malformed);
    const next = reducer(hydrated, setEnsName({ address: C, name: 'new.eth' }));
    expect(next.ensCache[A]).toBeUndefined();
    expect(next.ensCache[B]).toEqual(hydrated.ensCache[B]);
    expect(selectEnsNameToAddress({ vaultGlobal: next } as any)).toEqual({
      'healthy.eth': B,
      'new.eth': C,
    });
  }
);
