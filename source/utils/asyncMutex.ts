/**
 * AsyncMutex implementation for synchronizing async operations
 * Prevents race conditions by chaining promises to ensure sequential execution
 *
 * Based on the elegant implementation pattern from sysweb3-keyring
 */
export class AsyncMutex {
  private mutex = Promise.resolve();

  /**
   * Execute a function exclusively within the mutex.
   * Automatically handles acquiring and releasing the lock.
   *
   * @param callback Function to execute exclusively
   * @returns Promise resolving to the function's return value
   *
   * @example
   * const result = await mutex.runExclusive(async () => {
   *   // Critical section code here
   *   return someValue;
   * });
   */
  async runExclusive<T>(callback: () => T | Promise<T>): Promise<T> {
    // Capture the current mutex promise
    const oldMutex = this.mutex;

    // Create a new promise that will become the next mutex
    let release: () => void;
    this.mutex = new Promise((resolve) => {
      release = resolve;
    });

    // Wait for the previous operation to complete
    await oldMutex;

    try {
      // Execute the callback
      return await callback();
    } finally {
      // Release the lock for the next operation
      release!();
    }
  }
}

// Global mutexes for specific operations
export const updateMutex = new AsyncMutex();
export const fiatPriceMutex = new AsyncMutex();
export const networkSwitchMutex = new AsyncMutex();
export const fiatAlarmMutex = new AsyncMutex();
export const pollingMutex = new AsyncMutex();
export const emergencySaveMutex = new AsyncMutex();
export const accountSwitchMutex = new AsyncMutex();
