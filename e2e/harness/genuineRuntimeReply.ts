import type { Page } from '@playwright/test';

/**
 * Faults only delivery timing at Chrome's actual callback boundary. Every
 * matching request is forwarded once to the real worker, and its identical
 * result is retained privately. No controller, Redux state, DOM or payload is
 * substituted. Snapshot data contains counts and response kinds, never params
 * or private response content. Use only in a disposable launch-fenced profile.
 */
export async function installRuntimeReplyHold(page: Page) {
  await page.evaluate(() => {
    const original = chrome.runtime.sendMessage;
    let armed: string | undefined;
    let held: (() => void) | undefined;
    let receivedAt = 0;
    const calls: Record<string, number> = {};
    const observation = {
      heldMethod: '',
      held: false,
      realResponseKind: '',
      realResponseWasError: false,
      nativeTransportErrors: 0,
      releases: 0,
      heldForMs: 0,
    };
    chrome.runtime.sendMessage = ((...args: any[]) => {
      const [message, callback] = args;
      const methods = message?.data?.methods;
      const method =
        message?.type === 'CONTROLLER_ACTION' &&
        Array.isArray(methods) &&
        methods.length === 2 &&
        methods[0] === 'wallet'
          ? String(methods[1])
          : undefined;
      if (method) calls[method] = (calls[method] || 0) + 1;
      if (!method || method !== armed || typeof callback !== 'function') {
        return (original as any).apply(chrome.runtime, args);
      }
      armed = undefined;
      return (original as any).call(
        chrome.runtime,
        message,
        (response: any) => {
          // Native lastError only exists within this callback. Do not erase or
          // delay that error; this adapter holds an actually received reply.
          if (chrome.runtime.lastError) {
            observation.nativeTransportErrors += 1;
            callback(response);
            return;
          }
          if (held) throw new Error('A real runtime reply is already held');
          observation.heldMethod = method;
          observation.held = true;
          observation.realResponseKind = typeof response;
          observation.realResponseWasError = Boolean(
            response?.error ||
              (response?.success === false &&
                Object.prototype.hasOwnProperty.call(response, 'error'))
          );
          receivedAt = performance.now();
          held = () => callback(response);
        }
      );
    }) as typeof chrome.runtime.sendMessage;
    (window as any).__paliContractReplyHold = {
      arm(method: string) {
        if (held || armed) throw new Error('Runtime reply hold is not idle');
        armed = method;
      },
      snapshot() {
        return { ...observation, calls: { ...calls } };
      },
      release() {
        if (!held) throw new Error('No genuine runtime reply held');
        const deliver = held;
        held = undefined;
        observation.held = false;
        observation.releases += 1;
        observation.heldForMs = performance.now() - receivedAt;
        deliver();
      },
      restore() {
        chrome.runtime.sendMessage = original;
        armed = undefined;
        if (held) {
          const deliver = held;
          held = undefined;
          observation.held = false;
          deliver();
        }
        delete (window as any).__paliContractReplyHold;
      },
    };
  });
}

export const armRuntimeReply = (page: Page, method: string) =>
  page.evaluate(
    (name) => (window as any).__paliContractReplyHold.arm(name),
    method
  );

export const runtimeReplySnapshot = (page: Page) =>
  page.evaluate(() => (window as any).__paliContractReplyHold.snapshot());

export const releaseRuntimeReply = (page: Page) =>
  page.evaluate(() => (window as any).__paliContractReplyHold.release());

export const restoreRuntimeReply = (page: Page) =>
  page.evaluate(() => (window as any).__paliContractReplyHold?.restore());
