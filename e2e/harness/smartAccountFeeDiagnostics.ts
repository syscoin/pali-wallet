import type { BrowserContext } from '@playwright/test';

/** Synthetic-run metadata only: never retain params, results, IDs or signed bytes. */
export async function observeSmartAccountFeeDiagnostics(
  context: BrowserContext
) {
  const install = () => {
    if (
      !globalThis.chrome?.runtime?.id ||
      new URL(chrome.runtime.getURL('/')).host !== location.host ||
      (window as any).__paliSmartAccountFeeDiagnostics
    )
      return;
    const records: Array<Record<string, unknown>> = [];
    Object.defineProperty(window, '__paliSmartAccountFeeDiagnostics', {
      value: records,
    });
    const record = (stage: string, method: string, error?: unknown) => {
      const source =
        typeof error === 'string'
          ? { message: error }
          : error && typeof error === 'object'
          ? (error as Record<string, unknown>)
          : {};
      records.push({
        stage,
        method,
        at: performance.now(),
        ...(typeof source.message === 'string'
          ? {
              message: source.message
                .replace(/0x[0-9a-f]{16,}/gi, '[hex]')
                .slice(0, 240),
            }
          : {}),
        ...(typeof source.code === 'number' || typeof source.code === 'string'
          ? { code: String(source.code).slice(0, 80) }
          : {}),
      });
      if (records.length > 32) records.shift();
    };
    const connect = chrome.runtime.connect;
    chrome.runtime.connect = function (...args: any[]) {
      const port = Reflect.apply(connect, this, args) as chrome.runtime.Port;
      if (args[0]?.name !== 'pali-smart-account-controller') return port;
      let method = '';
      const post = port.postMessage;
      port.postMessage = function (message) {
        try {
          if (message?.type === 'CONTROLLER_ACTION') {
            method = String(message.data?.methods?.[1] ?? '').slice(0, 80);
            record('sent', method);
          } else if (message?.type === 'PALI_SMART_ACCOUNT_FEE_APPROVAL')
            record(message.approved ? 'fee-approved' : 'fee-declined', method);
        } catch {
          /* Preserve the original API call. */
        }
        return Reflect.apply(post, this, [message]);
      };
      port.onMessage.addListener((response) => {
        try {
          if (response?.type === 'PALI_SMART_ACCOUNT_FEE_REVIEW')
            record('fee-review', method);
          else {
            const error = response?.error === true ? response : response?.error;
            record(error ? 'rejected' : 'resolved', method, error);
          }
        } catch {
          /* Observation cannot change delivery. */
        }
      });
      port.onDisconnect.addListener(() => {
        try {
          record('disconnected', method, chrome.runtime.lastError);
        } catch {
          /* Already retired. */
        }
      });
      return port;
    } as typeof chrome.runtime.connect;
  };
  await context.addInitScript(install);
  await Promise.all(context.pages().map((page) => page.evaluate(install)));
}
