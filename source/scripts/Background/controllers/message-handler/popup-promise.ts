import { ethErrors } from 'helpers/errors';

import { ICustomEvent } from '../../../../types/index'; // need to use this relative import [avoid terminal error]
import {
  utxoDappApprovalExpired,
  watchApprovalSubmission,
  type DappUtxoReview,
} from '../../handlers/approvalSubmission';
import {
  bindPersonalSignApproval,
  capturePersonalSignApproval,
  personalSignApprovalExpired,
} from '../../handlers/personalSignApproval';
import { getController } from 'scripts/Background';
import { APPROVAL_CLIENT_READY, APPROVAL_REGISTER } from 'utils/approvalClient';
import cleanErrorStack from 'utils/cleanErrorStack';
import type { IEvmTransactionContext } from 'utils/evmTransactionContext';

import {
  assertRequestActive,
  isRequestDocumentLive,
  probeDocumentLiveness,
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

const isApprovalRoute = (url: URL, route: MethodRoute) =>
  url.pathname === '/external.html' ||
  url.pathname === `/external/${route}` ||
  (url.pathname === '/' && url.searchParams.get('externalRoute') === route);

const isApprovalClientLive = (
  clientId: string,
  approvalId: string,
  route: MethodRoute
) =>
  probeDocumentLiveness(async () => {
    const { clients } = self as unknown as {
      clients: { get: (id: string) => Promise<{ url: string } | undefined> };
    };
    const client = await clients.get(clientId);
    const url = client && readApprovalUrl(client.url, approvalId);
    return Boolean(url && isApprovalRoute(url, route));
  });

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
  if (!isApprovalRoute(sourceUrl, route)) return;
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

interface IPopupRequest {
  connectedPersonalSign?: boolean;
  data?: object;
  eventName: string;
  host: string;
  route: MethodRoute;
  sender?: chrome.runtime.MessageSender;
  signal?: AbortSignal;
}

/** Opens an approval popup for the original request document. */
export const popupPromise = async (request: IPopupRequest) => {
  if (!request.connectedPersonalSign) return openApprovalPopup(request);
  const { wallet } = getController();
  const approval = capturePersonalSignApproval({
    host: request.host,
    params: Array.isArray(request.data) ? request.data : undefined,
    sender: request.sender,
    signal: request.signal,
    getWalletSessionGeneration: () => wallet.getWalletSessionGeneration(),
  });
  try {
    approval.assertCurrent();
    return await openApprovalPopup(
      { ...request, signal: approval.signal },
      approval
    );
  } finally {
    approval.dispose();
  }
};

const openApprovalPopup = async (
  { data, eventName, host, route, signal, sender }: IPopupRequest,
  personalSignApproval?: ReturnType<typeof capturePersonalSignApproval>
) => {
  assertRequestActive(signal);
  if (!(await isRequestDocumentLive(sender))) throw requestCancelledError();
  personalSignApproval?.assertCurrent();
  const { createPopup } = getController();
  const approvalId = crypto.randomUUID();

  // URLSearchParams in createPopup escapes the payload without changing it.
  data = data || {};
  const { psbt, assets, sentryFeeAuthorization, approvedContext } =
    data as Partial<DappUtxoReview['psbt']> & {
      approvedContext?: DappUtxoReview['context'];
    };
  const utxoMethod =
    route === MethodRoute.SignTx
      ? 'signSendAndSaveTransaction'
      : route === MethodRoute.SignPsbt
      ? 'signSyscoinPsbt'
      : undefined;
  const utxoReview:
    | Omit<DappUtxoReview, 'assertCurrent' | 'checkDocument'>
    | undefined =
    utxoMethod &&
    approvedContext &&
    typeof psbt === 'string' &&
    typeof assets === 'string'
      ? {
          method: utxoMethod,
          context: approvedContext,
          psbt: { psbt, assets, sentryFeeAuthorization },
        }
      : undefined;

  let popup = null;
  let approvalClientId: string | null = null;
  let approvalDocumentId: string | null = null;
  let approvalTabId: number | undefined;
  let submissionStarted = false;
  let stopWatchingSubmission: (() => void) | undefined;
  let unbindApprovalDocument: (() => void) | undefined;
  let utxoApprovalRetired = false;
  let utxoDocumentCheck = 0;
  let utxoNavigationPending = false;
  let onAbort: (() => void) | null = null;
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
      ((personalSignApproval || utxoReview) &&
        registrationSender.tab?.id === undefined) ||
      (approvalDocumentId &&
        registrationSender.documentId !== approvalDocumentId)
    ) {
      reply({ status: 'unavailable', approvalId });
      return;
    }
    approvalDocumentId = registrationSender.documentId!;
    approvalTabId = registrationSender.tab?.id;
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
      const available =
        (!approvalClientId || approvalClientId === source.id) &&
        (!utxoReview || (!utxoApprovalRetired && !signal?.aborted)) &&
        (!personalSignApproval || personalSignApproval.isCurrent());
      if (available) {
        approvalClientId = source.id;
        const clientId = source.id;
        const approverIsLive = () =>
          isApprovalClientLive(clientId, approvalId, route);
        if (
          (personalSignApproval || utxoReview) &&
          approvalDocumentId &&
          !unbindApprovalDocument
        ) {
          const unbind =
            personalSignApproval &&
            bindPersonalSignApproval(
              approvalDocumentId,
              personalSignApproval,
              approverIsLive
            );
          const retire = () => {
            if (utxoReview) {
              utxoApprovalRetired = true;
              onAbort?.();
            }
            personalSignApproval?.retire();
          };
          const onNavigation = (
            tabId: number,
            change: chrome.tabs.TabChangeInfo
          ) => {
            if (tabId !== approvalTabId) return;
            if (change.url) {
              const destination = readApprovalUrl(change.url, approvalId);
              if (!destination || !isApprovalRoute(destination, route)) {
                retire();
                return;
              }
            }
            if (change.status === 'loading' && (!change.url || utxoReview)) {
              // Chrome can report loading during a same-document transition.
              // Resolve the originally enrolled client before treating it as a reload.
              const check = ++utxoDocumentCheck;
              utxoNavigationPending = Boolean(utxoReview);
              void approverIsLive().then((live) => {
                if (!live) retire();
                if (check === utxoDocumentCheck) utxoNavigationPending = false;
              });
            }
          };
          unbindApprovalDocument = () => {
            chrome.tabs.onUpdated.removeListener(onNavigation);
            unbind?.();
          };
          chrome.tabs.onUpdated.addListener(onNavigation);
        }
        if (
          (route === MethodRoute.SendEthTx ||
            route === MethodRoute.SendCalls ||
            route === MethodRoute.SmartAccount ||
            route === MethodRoute.SmartAccountModules ||
            route === MethodRoute.SignTx ||
            utxoReview) &&
          approvalDocumentId &&
          !stopWatchingSubmission
        )
          stopWatchingSubmission = watchApprovalSubmission(
            approvalDocumentId,
            (possible) => {
              submissionStarted = possible;
            },
            route === MethodRoute.SendEthTx || route === MethodRoute.SendCalls
              ? (data as { approvedContext?: IEvmTransactionContext })
                  .approvedContext
              : undefined,
            utxoReview
              ? {
                  ...utxoReview,
                  assertCurrent: () => {
                    if (
                      signal?.aborted ||
                      utxoApprovalRetired ||
                      utxoNavigationPending
                    )
                      throw utxoDappApprovalExpired();
                  },
                  async checkDocument() {
                    if (
                      !(await isRequestDocumentLive(sender)) ||
                      !(await approverIsLive())
                    )
                      throw utxoDappApprovalExpired();
                  },
                }
              : undefined
          );
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
    let livenessInterval: ReturnType<typeof setInterval> | null = null;
    let checkingLiveness = false;
    let bindingDeadline: ReturnType<typeof setTimeout> | null = null;
    let processingResponse = false;

    // Clean up function to remove listeners
    const cleanup = () => {
      unbindApprovalDocument?.();
      stopWatchingSubmission?.();
      stopWatchingSubmission = undefined;
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
      if (
        resolved ||
        (personalSignApproval && !personalSignApproval.isCurrent())
      ) {
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
    const cancellationError = () =>
      submissionStarted
        ? cleanErrorStack(
            ethErrors.rpc.internal(
              'Transaction submission outcome is unknown. Check the wallet activity and chain before submitting again.'
            )
          )
        : cleanErrorStack(
            ethErrors.provider.userRejectedRequest('User closed popup window')
          );

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
      reject(cancellationError());
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
      reject(
        submissionStarted
          ? cancellationError()
          : personalSignApproval
          ? personalSignApprovalExpired()
          : requestCancelledError()
      );
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
