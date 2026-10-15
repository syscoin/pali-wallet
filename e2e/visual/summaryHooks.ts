import { type test as playwrightTest } from '@playwright/test';

import { type PaliWallet } from '../harness/pali';

// Playwright replaces failed workers even with retries=0; keep each artifact.
export const visualJourneyName = (workerIndex: number) =>
  `visual-worker-${workerIndex}`;

// Visual tests use screenshot assertions directly, rather than wallet.step().
export const registerVisualSummaryHooks = (
  suite: Pick<typeof playwrightTest, 'afterEach' | 'afterAll'>,
  getWallet: () => Pick<PaliWallet, 'summary' | 'dispose'> | undefined
) => {
  let completed = 0;
  let allPassed = true;
  suite.afterEach(({}, info) => {
    completed += 1;
    const passed = info.status === 'passed';
    allPassed = allPassed && passed;
    getWallet()?.summary.addStep({
      durationMs: info.duration,
      name: info.title,
      note: info.error?.message,
      status: passed
        ? 'passed'
        : info.status === 'skipped'
        ? 'skipped'
        : 'failed',
    });
  });
  suite.afterAll(async () => {
    await getWallet()?.dispose(
      completed > 0 && allPassed ? 'passed' : 'failed'
    );
  });
};
