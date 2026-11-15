/* eslint-disable @typescript-eslint/no-var-requires */
export {};

const shared =
  require('./webpack.common').optimization.splitChunks.cacheGroups
    .smartAccountExecutionShared;

describe('smart-account execution chunk isolation', () => {
  test.each([
    ['/repo/source/pages/Send/EditPriority.tsx', true],
    ['C:\\repo\\source\\pages\\Send\\EditPriority.tsx', true],
    ['/repo/source/pages/Send/SendEth.tsx', false],
    ['/repo/source/pages/Send/EditPriority.spec.tsx', false],
  ])('shares only the exact fee-review page %s', (resource, expected) => {
    expect(shared.test({ resource })).toBe(expected);
  });

  test.each([
    ['app', 'app', false, true],
    ['external', 'external', false, true],
    ['both UI runtimes', new Set(['app', 'external']), false, true],
    ['initial UI entry', new Set(['app', 'external']), true, false],
    ['worker', 'background', false, false],
    ['mixed worker and UI', new Set(['app', 'background']), false, false],
    ['Ledger', 'ledgerHost', false, false],
    ['mixed Ledger and UI', new Set(['external', 'ledgerHost']), false, false],
    ['independent async entry', new Set(['app', 'independent']), false, false],
    ['missing runtime', undefined, false, false],
    ['empty runtime set', new Set(), false, false],
  ])('%s', (_label, runtime, initial, expected) => {
    expect(shared.chunks({ runtime, canBeInitial: () => initial })).toBe(
      expected
    );
  });
});
