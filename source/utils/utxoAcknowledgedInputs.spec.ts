import {
  assertNoRecentAcknowledgedInputOverlap,
  createUtxoAcknowledgedInputs,
  getRecentAcknowledgedInputOutpoints,
  UTXO_ACKNOWLEDGED_INPUTS_WINDOW_MS,
  UTXO_NETWORK_CATCHING_UP,
} from './utxoAcknowledgedInputs';

const now = 1_800_000_000_000;
const scope = {
  accountXpub: 'test-account-xpub',
  chainId: 5700,
  networkUrl: 'https://configured-blockbook.test',
};
const input = (byte: number, index = 0) => ({
  hash: Uint8Array.from({ length: 32 }, () => byte),
  index,
});
const first = input(1, 2);
const second = input(2, 3);
const metadata = () =>
  createUtxoAcknowledgedInputs([first, second], scope, now);
const history = () => ({
  [scope.chainId]: [{ localAcknowledgedInputs: metadata() }],
});

describe('ordinary Send acknowledged-input catch-up fence', () => {
  it('retains only compact public input metadata, with every input', () => {
    const local = metadata();
    expect(Object.keys(local).sort()).toEqual([
      'accountXpub',
      'acknowledgedAt',
      'networkUrl',
      'outpoints',
    ]);
    expect(local.outpoints).toEqual([
      `${'01'.repeat(32)}:2`,
      `${'02'.repeat(32)}:3`,
    ]);
    expect(JSON.stringify(local)).not.toMatch(/hex|psbt|witness|output|seed/i);
  });

  it('derives display-order txids without mutating the signed PSBT hash', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_v, index) => index);
    const original = Uint8Array.from(bytes);
    const local = createUtxoAcknowledgedInputs(
      [{ hash: bytes, index: 0xffffffff }],
      scope,
      now
    );
    expect(local.outpoints).toEqual([
      `${Buffer.from(original).reverse().toString('hex')}:4294967295`,
    ]);
    expect(bytes).toEqual(original);
  });

  it('refuses any overlap while allowing entirely new owned change inputs', () => {
    expect(() =>
      assertNoRecentAcknowledgedInputOverlap(
        [input(3), second],
        history(),
        scope,
        now
      )
    ).toThrow(/network is still updating/);
    expect(() =>
      assertNoRecentAcknowledgedInputOverlap([input(3)], history(), scope, now)
    ).not.toThrow();
    try {
      assertNoRecentAcknowledgedInputOverlap([first], history(), scope, now);
    } catch (error) {
      expect(error).toMatchObject({
        code: UTXO_NETWORK_CATCHING_UP,
        transactionNotBroadcast: true,
      });
    }
  });

  it('survives a plain persisted-history JSON round trip', () => {
    const reloaded = JSON.parse(JSON.stringify(history()));
    expect(() =>
      assertNoRecentAcknowledgedInputOverlap(
        [first],
        reloaded,
        scope,
        now + 600
      )
    ).toThrow(/network is still updating/);
  });

  it('expires exactly at two minutes and does not become a permanent spent lock', () => {
    expect(
      getRecentAcknowledgedInputOutpoints(
        history(),
        scope,
        now + UTXO_ACKNOWLEDGED_INPUTS_WINDOW_MS - 1
      ).size
    ).toBe(2);
    expect(
      getRecentAcknowledgedInputOutpoints(
        history(),
        scope,
        now + UTXO_ACKNOWLEDGED_INPUTS_WINDOW_MS
      ).size
    ).toBe(0);
  });

  it.each([
    { ...scope, chainId: 57 },
    { ...scope, accountXpub: 'another-account-xpub' },
    { ...scope, networkUrl: 'https://different-blockbook.test' },
  ])(
    'does not use another exact history/account/backend scope: %j',
    (other) => {
      expect(() =>
        assertNoRecentAcknowledgedInputOverlap([first], history(), other, now)
      ).not.toThrow();
    }
  );

  it.each([
    null,
    {},
    { acknowledgedAt: String(now) },
    { acknowledgedAt: now + 1 },
    { acknowledgedAt: -1 },
    { outpoints: null },
    { outpoints: [] },
    { outpoints: ['not-an-outpoint'] },
    { outpoints: [`${'01'.repeat(32)}:4294967296`] },
    { outpoints: [`${'01'.repeat(32)}:01`] },
    { outpoints: [`${'01'.repeat(32)}:-1`] },
    { outpoints: [metadata().outpoints[0], metadata().outpoints[0]] },
  ])(
    'ignores malformed or future local metadata without widening its scope: %j',
    (bad) => {
      const local = bad === null ? null : { ...metadata(), ...bad };
      // The empty object case explicitly has no valid metadata fields.
      const value = bad && !Object.keys(bad).length ? bad : local;
      const rows = { [scope.chainId]: [{ localAcknowledgedInputs: value }] };
      expect(
        getRecentAcknowledgedInputOutpoints(rows as any, scope, now).size
      ).toBe(0);
    }
  );

  it.each([
    { inputs: [] },
    { inputs: [input(1), input(1)] },
    { inputs: [{ hash: Uint8Array.from([1]), index: 0 }] },
    { inputs: [{ hash: '01'.repeat(32), index: 0 }] },
    { inputs: [{ hash: first.hash, index: -1 }] },
    { inputs: [{ hash: first.hash, index: 1.5 }] },
    { inputs: [{ hash: first.hash, index: 0x100000000 }] },
  ])(
    'does not turn malformed prepared inputs into an accepted acknowledgement: %j',
    ({ inputs }) => {
      expect(() =>
        createUtxoAcknowledgedInputs(inputs as any, scope, now)
      ).toThrow();
    }
  );
});
