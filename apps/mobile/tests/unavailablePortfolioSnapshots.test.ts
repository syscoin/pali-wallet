import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountActivityController } from '../src/activity/accountActivity.ts';
import { AccountPortfolioController } from '../src/portfolio/accountPortfolio.ts';

for (const Model of [AccountActivityController, AccountPortfolioController]) {
  test(`${Model.name} caches unavailable snapshots without starting reads`, async () => {
    let requests = 0;
    const unexpected = () => { requests++; throw Error('No reads from a locked wallet'); };
    const model = new Model({
      source: { getSnapshot: () => ({ phase: 'locked', revision: 1, account: null }) as any,
        getCatalogue: () => null, subscribe: () => () => undefined },
      choices: unexpected,
      filter: { load: async () => 'all', save: async () => undefined },
      reader: { readBalance: unexpected }, runtime: unexpected,
      explorer: { page: unexpected }, receipts: { read: unexpected },
    });
    const stop = model.connect();
    await new Promise<void>(resolve => setImmediate(resolve));
    const snapshot = model.getSnapshot();
    assert.equal(snapshot.status, 'unavailable');
    for (let index = 0; index < 20; index++) assert.equal(model.getSnapshot(), snapshot);
    assert.equal(requests, 0);
    stop();
  });
}
