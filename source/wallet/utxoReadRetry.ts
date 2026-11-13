import { utils as syscoinUtils } from 'syscoinjs-lib';

import {
  abortable,
  cancelResponseBody,
  checkAborted,
} from '../shared/boundedHttp.ts';

class RetryableResponse extends Error {
  readonly status: 429 | 503;
  constructor(status: 429 | 503) {
    super('Blockbook temporarily unavailable');
    this.status = status;
  }
}

/** Retry only read responses, inside the caller's existing ownership and time budget. */
export async function fetchUtxoRead(
  transport: (input: string, initOptions: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit,
  assertCurrent: () => void
): Promise<Response> {
  const signal = init.signal;
  if (
    typeof url !== 'string' ||
    init.method !== 'GET' ||
    !signal ||
    (init.body !== undefined && init.body !== null)
  )
    throw new Error('Invalid Blockbook read request');
  const request = Object.freeze({ ...init, method: 'GET', signal });
  const check = () => {
    checkAborted(signal);
    assertCurrent();
    checkAborted(signal);
  };
  try {
    return await syscoinUtils.retryWithBackoff(
      async () => {
        try {
          check();
          const pending = transport(url, request).then((response) => {
            try {
              check();
              return response;
            } catch (error) {
              cancelResponseBody(response);
              throw error;
            }
          });
          // A transport may synchronously abort before abortable can observe it.
          void pending.catch(() => undefined);
          const response = await abortable(pending, signal);
          try {
            check();
          } catch (error) {
            cancelResponseBody(response);
            throw error;
          }
          if (response.status === 429 || response.status === 503) {
            cancelResponseBody(response);
            throw new RetryableResponse(response.status);
          }
          return response;
        } catch (error) {
          // The SDK also matches error text. Only our actual HTTP statuses may retry.
          if (error instanceof RetryableResponse) throw error;
          throw new Error('Blockbook read unavailable');
        }
      },
      0,
      signal
    );
  } catch {
    check();
    // Do not let an enclosing SDK read restart an exhausted four-attempt budget.
    throw new Error('Blockbook read unavailable');
  }
}
