import { ethErrors } from 'helpers/errors';

import { ICustomEvent } from '../../../../types/index'; // need to use this relative import [avoid terminal error]
import { getController } from 'scripts/Background';
import { APPROVAL_CLIENT_READY, APPROVAL_REGISTER } from 'utils/approvalClient';
import cleanErrorStack from 'utils/cleanErrorStack';

import {
  assertRequestActive,
  isRequestDocumentLive,
  requestCancelledError,
} from './request-lifetime';
import { MethodRoute } from './types';

const readApprovalUrl = (url: string, approvalId: string): URL | undefined => {
  try {
    const parsed = new URL(url);
    const expected = new URL(chrome.runtime.getURL('external.html'));
    if (
      parsed.protocol === expected.protocol &&
      parsed.host === expected.host &&
      JSON.parse(parsed.searchParams.get('data') || '{}').approvalId ===
        approvalId
    )
      return parsed;
  } catch {
    // Missing/malformed browser-supplied URLs cannot identify an approval.
  }
  return undefined;
};

const handleResponseEvent = async (
  event: ICustomEvent,
  eventName: string,
  host: string,
  approvalId: string,
  approvalClientId: string | null,
  route: MethodRoute,
  resolve: (value: unknown) => void,
  sender?: chrome.runtime.MessageSender,
  onStale?: () => void,
  onResponseStart?: () => void
): Promise<void> => {
  const expectedEventName = `${eventName}.${host}`;
  // Client.id identifies the created document even after BrowserRouter changes
  // Client.url. A reload/new view cannot inherit its approval capability.
  const source = (event as any).source;
  const sourceUrl = readApprovalUrl(source?.url, approvalId);
  if (!approvalClientId || source?.id !== approvalClientId || !sourceUrl)
    return;
  const expectedPath = `/external/${route}`;
  if (
    sourceUrl.pathname !== '/external.html' &&
    sourceUrl.pathname !== expectedPath &&
    !(
      sourceUrl.pathname === '/' &&
      sourceUrl.searchParams.get('externalRoute') === route
    )
  )
    return;
  if (event.data?.eventName !== expectedEventName) {
    return;
  }
  onResponseStart?.();

  if (!(await isRequestDocumentLive(sender))) {
    onStale?.();
    return;
  }

  // Always resolve with the actual data sent by the component
  if (event.data.detail) {
    try {
      const parsedDetail = JSON.parse(event.data.detail);
      resolve(parsedDetail);
    } catch (error) {
      console.error('Error parsing event detail:', error);
      onStale?.(); // Malformed approval data must never count as acceptance.
    }
  } else {
    // Component sent a message but with no detail - resolve with null
    resolve(null);
  }
};

/**
 * Opens a popup and adds events listener to resolve a promise.
 *
 * @param host The dApp host
 * @param route The popup route
 * @param eventName The event which will resolve the promise.
 * The final event name is `eventName.host`
 * @param data information that will be passed to the route. Optional
 *
 * @return either the event data or `null` for success
 */
export const popupPromise = async ({
  data,
  eventName,
  host,
  route,
  signal,
  sender,
}: {
  data?: object;
  eventName: string;
  host: string;
  route: MethodRoute;
  sender?: chrome.runtime.MessageSender;
  signal?: AbortSignal;
}) => {
  assertRequestActive(signal);
  if (!(await isRequestDocumentLive(sender))) throw requestCancelledError();
  const { createPopup } = getController();
  const approvalId = crypto.randomUUID();

  // URLSearchParams in createPopup escapes the payload without changing it.
  data = data || {};

  let popup = null;
  let approvalClientId: string | null = null;
  let approvalDocumentId: string | null = null;
  let challenge: string | null = null;
  let responseHandler: ((event: any) => void) | null = null;
  const registrations: Array<{
    reply: (response: any) => void;
    sender: chrome.runtime.MessageSender;
  }> = [];
  const register = (
    registrationSender: chrome.runtime.MessageSender,
    reply: (response: any) => void
  ) => {
    if (
      registrationSender.tab?.windowId !== popup?.id ||
      (approvalDocumentId &&
        registrationSender.documentId !== approvalDocumentId)
    ) {
      reply({ status: 'unavailable', approvalId });
      return;
    }
    approvalDocumentId = registrationSender.documentId!;
    challenge ||= crypto.randomUUID();
    reply({ status: 'registered', approvalId, challenge });
  };
  const registrationHandler = (
    message: any,
    registrationSender: chrome.runtime.MessageSender,
    reply: (response: any) => void
  ) => {
    if (
      message?.type !== APPROVAL_REGISTER ||
      message.approvalId !== approvalId
    )
      return false;
    const url = readApprovalUrl(registrationSender.url || '', approvalId);
    if (
      registrationSender.id !== chrome.runtime.id ||
      registrationSender.frameId !== 0 ||
      !registrationSender.documentId ||
      url?.pathname !== '/external.html'
    ) {
      reply({ status: 'unavailable', approvalId });
      return false;
    }
    if (popup) register(registrationSender, reply);
    else if (registrations.length < 4)
      registrations.push({ sender: registrationSender, reply });
    else reply({ status: 'unavailable', approvalId });
    return true;
  };
  let onClientBound: (() => void) | null = null;
  const messageHandler = (event: any) => {
    if (event.data?.eventName === APPROVAL_CLIENT_READY) {
      const source = event.source;
      const url = readApprovalUrl(source?.url, approvalId);
      const port = event.ports?.[0];
      if (
        !challenge ||
        event.data?.challenge !== challenge ||
        event.data?.approvalId !== approvalId ||
        url?.pathname !== '/external.html' ||
        typeof source?.id !== 'string' ||
        !source.id ||
        !port
      )
        return;
      const available = !approvalClientId || approvalClientId === source.id;
      if (available) {
        approvalClientId = source.id;
        onClientBound?.();
      }
      port.postMessage({
        eventName: APPROVAL_CLIENT_READY,
        approvalId,
        status: available ? 'ready' : 'unavailable',
      });
      port.close();
      return;
    }
    responseHandler?.(event);
  };

  // The initial document may execute before windows.create invokes its
  // callback. Register first, then verify its browser-supplied popup identity.
  self.addEventListener('message', messageHandler);
  chrome.runtime.onMessage.addListener(registrationHandler);

  try {
    popup = await createPopup(route, { ...data, host, eventName, approvalId });
  } catch (error) {
    self.removeEventListener('message', messageHandler);
    chrome.runtime.onMessage.removeListener(registrationHandler);
    registrations
      .splice(0)
      .forEach(({ reply }) => reply({ status: 'unavailable', approvalId }));
    // Clear the flag if popup creation failed
    chrome.storage.local.remove(
      ['pali-popup-open', 'pali-popup-timestamp'],
      () => {
        if (chrome.runtime.lastError) {
          console.error(
            '[popup-promise] Failed to remove flags on error:',
            chrome.runtime.lastError
          );
        }
      }
    );
    throw error;
  }

  return new Promise((resolve, reject) => {
    let windowRemovalHandler: any = null;
    let resolved = false;
    let onAbort: (() => void) | null = null;
    let livenessInterval: ReturnType<typeof setInterval> | null = null;
    let checkingLiveness = false;
    let bindingDeadline: ReturnType<typeof setTimeout> | null = null;
    let processingResponse = false;

    // Clean up function to remove listeners
    const cleanup = () => {
      if (livenessInterval) clearInterval(livenessInterval);
      if (bindingDeadline) clearTimeout(bindingDeadline);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
      self.removeEventListener('message', messageHandler);
      chrome.runtime.onMessage.removeListener(registrationHandler);
      responseHandler = null;
      onClientBound = null;
      registrations
        .splice(0)
        .forEach(({ reply }) => reply({ status: 'unavailable', approvalId }));
      if (windowRemovalHandler) {
        chrome.windows.onRemoved.removeListener(windowRemovalHandler);
        windowRemovalHandler = null;
      }
    };

    // Safe resolve function that prevents double resolution
    const safeResolve = (result: any) => {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanup();
      // Clear the storage flag when popup resolves (either success or cancelled)
      chrome.storage.local.remove(
        ['pali-popup-open', 'pali-popup-timestamp'],
        () => {
          if (chrome.runtime.lastError) {
            console.error(
              '[popup-promise] Failed to remove flags on resolve:',
              chrome.runtime.lastError
            );
          }
        }
      );
      resolve(result);
    };

    // Message handler
    responseHandler = (swEvent: any) => {
      if (resolved || processingResponse) return;
      handleResponseEvent(
        swEvent,
        eventName,
        host,
        approvalId,
        approvalClientId,
        route,
        safeResolve,
        sender,
        () => onAbort?.(),
        () => {
          processingResponse = true;
        }
      );
    };

    // Window removal handler
    windowRemovalHandler = (windowId: number) => {
      if (windowId !== popup.id || resolved || processingResponse) {
        return;
      }

      // Clear the storage flag when popup closes
      chrome.storage.local.remove(
        ['pali-popup-open', 'pali-popup-timestamp'],
        () => {
          if (chrome.runtime.lastError) {
            console.error(
              '[popup-promise] Failed to remove flags on window close:',
              chrome.runtime.lastError
            );
          }
        }
      );

      // Reject with user rejection error instead of resolving with null
      // This allows null to be used as a valid success response
      cleanup();
      resolved = true; // Mark as resolved to prevent double resolution
      reject(
        cleanErrorStack(
          ethErrors.provider.userRejectedRequest('User closed popup window')
        )
      );
    };

    onAbort = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      chrome.storage.local.remove(['pali-popup-open', 'pali-popup-timestamp']);
      // Closing an approval rejects it; cancellation never authorizes a request.
      chrome.windows.remove(popup.id, () => {
        void chrome.runtime.lastError;
      });
      reject(requestCancelledError());
    };

    // Add listeners
    chrome.windows.onRemoved.addListener(windowRemovalHandler);
    // Soft UI feedback appears at 1.8 seconds; abandoned/unbound documents get
    // a separate hard deadline so flags and the popup cannot strand the queue.
    bindingDeadline = setTimeout(() => onAbort?.(), 10000);
    onClientBound = () => {
      if (bindingDeadline) clearTimeout(bindingDeadline);
      bindingDeadline = null;
    };
    registrations
      .splice(0)
      .forEach(({ sender: registrationSender, reply }) =>
        register(registrationSender, reply)
      );
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    if (sender?.documentId && !resolved) {
      livenessInterval = setInterval(async () => {
        if (checkingLiveness || resolved) return;
        checkingLiveness = true;
        try {
          if (!(await isRequestDocumentLive(sender))) onAbort?.();
        } finally {
          checkingLiveness = false;
        }
      }, 1000);
    }
  });
};
