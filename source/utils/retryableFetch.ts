// Retry configuration for blockbook API calls
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

/**
 * Generic retry function with exponential backoff for handling rate limiting (503/429 errors)
 * Based on the implementation from syscoinjs-lib
 *
 * @param fn - Function to retry
 * @param retryCount - Internal retry counter (starts at 0)
 * @returns Promise with the result of the function or throws error after max retries
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retryCount = 0
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    // Check if it's a retryable error (503 Service Unavailable or 429 Too Many Requests)
    const isRetryableError =
      (error.response &&
        (error.response.status === 503 || error.response.status === 429)) ||
      error.status === 503 ||
      error.status === 429 ||
      (error.message &&
        (error.message.includes('503') ||
          error.message.includes('429') ||
          error.message.includes('Service Unavailable') ||
          error.message.includes('Too many requests') ||
          error.message.includes('rate limit')));

    if (isRetryableError && retryCount < MAX_RETRIES) {
      const delay = INITIAL_RETRY_DELAY * Math.pow(2, retryCount);
      console.log(
        `[retryWithBackoff] Blockbook API rate limited, retrying after ${delay}ms... (attempt ${
          retryCount + 1
        }/${MAX_RETRIES})`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return retryWithBackoff(fn, retryCount + 1);
    }

    // If not retryable or max retries reached, throw the error
    throw error;
  }
}

/**
 * Helper function to create retryable fetch calls with proper error handling
 * Specifically designed for blockbook API calls
 *
 * @param url - URL to fetch
 * @param options - Fetch options (including optional timeout in ms)
 * @returns Promise with Response object
 */
export async function retryableFetch(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  return retryWithBackoff(async () => {
    // Default timeout of 30 seconds if not specified
    const timeout = options.timeout ?? 30000;

    // Create AbortController if signal not provided
    let abortController: AbortController | undefined;
    let timeoutId: NodeJS.Timeout | undefined;
    let signal = options.signal;

    if (!signal && timeout > 0) {
      abortController = new AbortController();
      signal = abortController.signal;

      // Set up timeout
      timeoutId = setTimeout(() => {
        abortController?.abort();
      }, timeout);
    }

    try {
      const response = await fetch(url, { ...options, signal });

      // Check for retryable status codes and throw appropriate errors
      if (!response.ok) {
        if (response.status === 503 || response.status === 429) {
          const error = new Error(
            `HTTP ${response.status}: ${response.statusText}`
          );
          (error as any).status = response.status;
          throw error;
        } else {
          // For non-retryable errors, get the response text for better error messages
          const responseData = await response.text();
          throw new Error(
            `HTTP error! Status: ${response.status}. Details: ${responseData}`
          );
        }
      }

      return response;
    } catch (error: any) {
      // Handle timeout error
      if (error.name === 'AbortError' && timeoutId) {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      throw error;
    } finally {
      // Clear timeout if it was set
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  });
}
