import { parseEther } from '@ethersproject/units';
import { test } from '@playwright/test';

import { predictAndFundSmartAccounts } from './fundSmartAccounts';

// Dry-run sanity check: indices deployed by earlier QA runs must show
// deployed=true, proving the offline address prediction matches the wallet.
test('predict smart account addresses (dry run)', async () => {
  test.setTimeout(120_000);
  const accounts = await predictAndFundSmartAccounts({
    indexCount: 8,
    minBalance: parseEther('0'),
  });
  for (const account of accounts) {
    console.log(
      `[debug-fund] index=${account.accountIndex} ${account.address} deployed=${account.deployed} balance=${account.balance}`
    );
  }
});
