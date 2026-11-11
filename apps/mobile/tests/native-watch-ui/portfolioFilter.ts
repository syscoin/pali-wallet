import { createPortfolioFilter } from '../../src/portfolio/portfolioFilter';

// Platform.OS is deliberately native in this browser fixture; preferences use
// an explicit local port instead of invoking an unavailable native SecureStore.
let value: string | null = null;
export const portfolioFilter = createPortfolioFilter({
  async get() { return value; },
  async set(next) { value = next; },
});
