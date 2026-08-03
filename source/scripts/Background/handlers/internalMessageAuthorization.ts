const PRIVILEGED_INTERNAL_MESSAGE_TYPES = new Set([
  'PALI_SLH_DSA_SETUP_PROGRESS',
  'changeNetwork',
  'getCurrentState',
  'lock_wallet',
  'startPolling',
]);

type RuntimeIdentity = Pick<typeof chrome.runtime, 'getURL' | 'id'>;

export const isPrivilegedInternalMessage = (type: string) =>
  PRIVILEGED_INTERNAL_MESSAGE_TYPES.has(type);

/**
 * Content scripts share the extension id, so sender.id alone does not prove
 * that a message came from an extension UI page. Require the sender URL to be
 * on this extension's own origin as well.
 */
export const isTrustedExtensionPageSender = (
  sender: chrome.runtime.MessageSender,
  runtime: RuntimeIdentity = chrome.runtime
): boolean => {
  if (!sender?.url || sender.id !== runtime.id) {
    return false;
  }

  try {
    const extensionUrl = new URL(runtime.getURL(''));
    const senderUrl = new URL(sender.url);
    return (
      senderUrl.protocol === extensionUrl.protocol &&
      senderUrl.host === extensionUrl.host
    );
  } catch {
    return false;
  }
};
