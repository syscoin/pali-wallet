import {
  hasNonReplaceableUtxoSequences,
  isPendingZdagActivity,
} from './utxoActivityStatus';

it.each([
  [undefined, false],
  [[], false],
  [[null], false],
  [[{}], false],
  [[{ sequence: '4294967295' }], false],
  [[{ sequence: -1 }], false],
  [[{ sequence: 0xfffffffd }], false],
  [[{ sequence: 0x100000000 }], false],
  [[{ sequence: 0xfffffffe }], true],
  [[{ sequence: 0xffffffff }], true],
  [[{ sequence: 0xfffffffe }, { sequence: 0xffffffff }], true],
  [[{ sequence: 0xffffffff }, {}], false],
])(
  'requires every input to carry a non-replaceable sequence: %p',
  (inputs, expected) => {
    expect(hasNonReplaceableUtxoSequences(inputs)).toBe(expected);
    expect(isPendingZdagActivity({ asset: true, inBlock: false, inputs })).toBe(
      expected
    );
  }
);

it('keeps ordinary pending and block-confirmed activity distinct from Z-DAG', () => {
  const inputs = [{ sequence: 0xffffffff }];
  expect(isPendingZdagActivity({ asset: false, inBlock: false, inputs })).toBe(
    false
  );
  expect(isPendingZdagActivity({ asset: true, inBlock: true, inputs })).toBe(
    false
  );
  expect(isPendingZdagActivity({ asset: true, inBlock: false, inputs })).toBe(
    true
  );
});
