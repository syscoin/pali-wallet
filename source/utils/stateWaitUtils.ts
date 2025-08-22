import store from 'state/store';

/**
 * Wait for a specific state condition to be met
 * @param selector Function that selects and checks the state condition
 * @param timeoutMs Maximum time to wait (default 5000ms)
 * @param pollIntervalMs How often to check the state (default 100ms)
 * @returns Promise that resolves when condition is met or rejects on timeout
 */
export const waitForStateCondition = <T>(
  selector: (state: any) => T | undefined,
  timeoutMs: number = 5000,
  pollIntervalMs: number = 100
): Promise<T> =>
  new Promise((resolve, reject) => {
    const startTime = Date.now();

    // Check immediately
    const initialValue = selector(store.getState());
    if (initialValue !== undefined) {
      resolve(initialValue);
      return;
    }

    // Set up polling
    const interval = setInterval(() => {
      const value = selector(store.getState());

      if (value !== undefined) {
        clearInterval(interval);
        resolve(value);
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(interval);
        reject(new Error('Timeout waiting for state condition'));
      }
    }, pollIntervalMs);
  });

/**
 * Wait for network to be fully switched and state to be updated
 * @param expectedNetworkId The network ID we're switching to
 * @param timeoutMs Maximum time to wait
 * @returns Promise that resolves when network is switched
 */
export const waitForNetworkSwitch = async (
  expectedNetworkId: string | number,
  timeoutMs: number = 5000
): Promise<void> => {
  await waitForStateCondition((state) => {
    const { activeNetwork } = state.vault;
    const networkIdMatches =
      activeNetwork?.chainId?.toString() === expectedNetworkId.toString();
    return networkIdMatches ? true : undefined;
  }, timeoutMs);
};

/**
 * Wait for transaction to appear in state
 * @param txHash Transaction hash to wait for
 * @param timeoutMs Maximum time to wait
 * @returns Promise that resolves when transaction appears
 */
export const waitForTransactionInState = async (
  txHash: string,
  timeoutMs: number = 10000
): Promise<void> => {
  await waitForStateCondition((state) => {
    const vault = state.vault;
    const activeId = vault?.activeAccount?.id;
    const activeType = vault?.activeAccount?.type;
    const accountTxs = vault?.accountTransactions?.[activeType]?.[activeId];
    if (!accountTxs) return undefined;
    const allTxArrays = Object.values(accountTxs || {}) as any[]; // { ethereum: {}, syscoin: {} }
    const found = allTxArrays.some((txsByHash: any) =>
      Object.values(txsByHash || {}).some(
        (tx: any) => tx?.hash?.toLowerCase() === txHash.toLowerCase()
      )
    );
    return found ? true : undefined;
  }, timeoutMs);
};
