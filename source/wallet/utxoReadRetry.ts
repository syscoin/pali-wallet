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

function retryNotBefore(value: string | null): number {
  if (!value) return 0;
  const text = value.trim();
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return Number.isSafeInteger(seconds) &&
      seconds <= Number.MAX_SAFE_INTEGER / 1000
      ? Date.now() + seconds * 1000
      : Infinity;
  }
  if (
    !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      text
    )
  )
    return 0;
  const date = Date.parse(text);
  return Number.isFinite(date) ? Math.max(Date.now(), date) : 0;
}

/** Retry only read responses, inside the caller's existing ownership and time budget. */
export async function fetchUtxoRead(
  transport: (input: string, initOptions: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit,
  assertCurrent: () => void,
  deadline = Date.now() + 12_000,
  retry = true
): Promise<Response> {
  const signal = init.signal;
  if (
    typeof url !== 'string' ||
    init.method !== 'GET' ||
    !signal ||
    (init.body !== undefined && init.body !== null) ||
    !Number.isFinite(deadline)
  )
    throw new Error('Invalid Blockbook read request');
  const request = Object.freeze({ ...init, method: 'GET', signal });
  let notBefore = 0;
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
          const wait = notBefore - Date.now();
          if (Date.now() >= deadline || notBefore >= deadline)
            throw new Error('Blockbook read unavailable');
          if (wait > 0) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
              await abortable(
                new Promise<void>((resolve) => {
                  timer = setTimeout(resolve, wait);
                }),
                signal
              );
            } finally {
              clearTimeout(timer);
            }
            check();
          }
          if (Date.now() >= deadline)
            throw new Error('Blockbook read unavailable');
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
          if (retry && (response.status === 429 || response.status === 503)) {
            notBefore = retryNotBefore(response.headers.get('retry-after'));
            cancelResponseBody(response);
            if (notBefore >= deadline)
              throw new Error('Blockbook read unavailable');
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
