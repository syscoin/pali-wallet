import canaryFeed from '../../releases/wallet-updates-canary.json';
import feed from '../../releases/wallet-updates.json';

import { parseWalletReleaseFeed } from './walletRelease';

it('keeps the published advisory feed within the shared validated contract', () => {
  expect(parseWalletReleaseFeed(feed)).not.toBeNull();
  expect(parseWalletReleaseFeed(canaryFeed)).not.toBeNull();
});
