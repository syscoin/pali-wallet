import { type BrowserContext, type Route } from '@playwright/test';
import { randomBytes } from 'crypto';

export type FixtureReadinessAttempt = {
  attempt: number;
  count: number;
  elapsedMs: number;
  error: boolean;
  identityRefused: boolean;
  responseMatched: boolean;
  routeRemoved: boolean;
  url: string;
};

// Chromium may expose the MV3 worker before Playwright has enabled Fetch
// interception for it. Probe only a nonce GET; never retry a wallet operation.
export async function waitForFixtureInterception(
  context: BrowserContext,
  extensionId: string,
  record: (attempt: FixtureReadinessAttempt) => Promise<void>
) {
  if (process.env.PLAYWRIGHT_DISABLE_SERVICE_WORKER_NETWORK)
    throw new Error('Fixture service-worker interception must be enabled');
  const expectedWorker = `chrome-extension://${extensionId}/js/background.bundle.js`;
  const workers = context
    .serviceWorkers()
    .filter((worker) => worker.url() === expectedWorker);
  if (workers.length !== 1)
    throw new Error('Expected exactly one fixture extension worker');
  const worker = workers[0];
  const started = Date.now();
  const deadline = started + 15000;
  for (let attempt = 1; attempt <= 6 && Date.now() < deadline; attempt++) {
    const nonce = randomBytes(16).toString('hex');
    const url = `https://127.0.0.1:49239/pali-fixture-readiness-${nonce}`;
    const row: FixtureReadinessAttempt = {
      attempt,
      elapsedMs: Date.now() - started,
      url,
      count: 0,
      identityRefused: false,
      responseMatched: false,
      error: false,
      routeRemoved: false,
    };
    const handler = async (route: Route) => {
      const request = route.request();
      row.count++;
      if (
        row.count !== 1 ||
        request.method() !== 'GET' ||
        request.url() !== url ||
        request.serviceWorker() !== worker ||
        worker.url() !== expectedWorker
      ) {
        row.identityRefused = true;
        await route.abort('blockedbyclient');
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/plain',
        headers: { 'access-control-allow-origin': '*' },
        body: nonce,
      });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      await context.route(url, handler);
      const budget = Math.min(8000, deadline - Date.now());
      if (budget <= 0) throw new Error('Fixture readiness deadline');
      const result = await Promise.race([
        worker.evaluate(
          async ({ target, budget: workerBudget }) => {
            const abort = new AbortController();
            const fetchTimer = setTimeout(() => abort.abort(), workerBudget);
            try {
              const response = await fetch(target, {
                method: 'GET',
                credentials: 'omit',
                cache: 'no-store',
                redirect: 'error',
                signal: abort.signal,
              });
              return { status: response.status, body: await response.text() };
            } finally {
              clearTimeout(fetchTimer);
            }
          },
          { target: url, budget }
        ),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error('Fixture interception timeout'));
          }, budget);
        }),
      ]);
      row.responseMatched = result.status === 200 && result.body === nonce;
    } catch {
      row.error = true;
    } finally {
      clearTimeout(timer);
      try {
        await context.unroute(url, handler);
        row.routeRemoved = true;
      } catch {
        row.error = true;
      }
    }
    // Preserve each public failed attempt before considering another nonce.
    await record(row);
    if (
      row.count === 1 &&
      row.responseMatched &&
      !row.identityRefused &&
      row.routeRemoved &&
      !row.error
    )
      return { attempts: attempt, elapsedMs: Date.now() - started };
    if (
      row.identityRefused ||
      row.count !== 0 ||
      !row.error ||
      !row.routeRemoved ||
      timedOut
    )
      throw new Error('Fixture interception readiness refused');
    if (attempt < 6 && Date.now() + 1000 < deadline)
      await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Fixture interception readiness unproven');
}
