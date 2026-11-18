import { checkIfPopupIsOpen } from './checkPopupOpen';
import { getNotificationTranslator } from './notificationLocale';
import type { ActivityNotificationFact } from '../shared/activityNotifications';

export interface INotificationOptions {
  buttons?: Array<{
    title: string;
  }>;
  clickAction?: () => void | Promise<void>;
  clickUrl?: string;
  eventTime?: number;
  iconUrl?: string;
  imageUrl?: string;
  isClickable?: boolean;
  isCurrent?: () => boolean;
  message: string;
  priority?: 0 | 1 | 2;
  requireInteraction?: boolean;
  silent?: boolean;
  title: string;
  type?: 'basic' | 'image' | 'list' | 'progress';
}

export interface ITransactionNotification {
  chainId: number;
  from: string;
  network: string;
  to?: string;
  tokenSymbol?: string;
  transactionType?: string;
  txHash: string;
  type: 'pending' | 'confirmed' | 'failed';
  value?: string; // For future use: SPT color info, etc.
}

// Track notification IDs to their metadata
const notificationMap = new Map<string, INotificationOptions>();
const GENERIC_WALLET_NOTICE = /^pali_wallet_(?:buttons_)?\d{1,16}_[a-z0-9]+$/;

const notificationIsCurrent = (
  notification?: INotificationOptions
): boolean => {
  try {
    return notification?.isCurrent?.() !== false;
  } catch {
    return false;
  }
};

const openNotificationWallet = async (
  isCurrent: () => boolean = () => true
): Promise<void> => {
  if (!isCurrent()) return;
  try {
    if (typeof chrome.action?.openPopup === 'function') {
      await chrome.action.openPopup();
      return;
    }
  } catch {
    // Older ordinary installations may expose the API but reject its use.
  }
  if (!isCurrent()) return;
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('app.html') });
  } catch {
    // The user can still open the wallet from the extension action.
  }
};

/** Only our wallet-only identity plus a still-held OS notice survives worker retirement. */
const isHeldGenericNotice = (id: string, button: boolean): Promise<boolean> => {
  if (
    !GENERIC_WALLET_NOTICE.test(id) ||
    (button && !id.startsWith('pali_wallet_buttons_'))
  )
    return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      chrome.notifications.getAll((all) => {
        if (
          chrome.runtime.lastError ||
          !Object.prototype.hasOwnProperty.call(all, id)
        ) {
          resolve(false);
          return;
        }
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
};

// Check if browser supports notifications
export const isNotificationSupported = (): boolean =>
  'notifications' in chrome && chrome.notifications !== undefined;

// Create a notification
export const createNotification = async (
  options: INotificationOptions
): Promise<string | null> => {
  if (!isNotificationSupported()) {
    console.warn('Notifications not supported');
    return null;
  }

  // Don't show notifications if popup is open (user is actively using the wallet)
  const popupOpen = await checkIfPopupIsOpen();
  if (options.isCurrent && !options.isCurrent()) return null;
  if (popupOpen && !options.requireInteraction) {
    return null;
  }
  const genericWallet =
    options.clickAction === undefined &&
    options.clickUrl === undefined &&
    options.isCurrent === undefined;
  const notificationId = `${
    genericWallet
      ? options.buttons?.length
        ? 'pali_wallet_buttons'
        : 'pali_wallet'
      : 'pali'
  }_${Date.now()}_${Math.random().toString(36).slice(2) || '0'}`;

  const baseOptions: any = {
    type: options.type || 'basic',
    iconUrl:
      options.iconUrl ||
      chrome.runtime.getURL('assets/all_assets/favicon-32.png'),
    title: options.title,
    message: options.message,
    priority: options.priority || 1,
    requireInteraction: options.requireInteraction || false,
    silent: options.silent || false,
  };

  if (options.buttons) {
    baseOptions.buttons = options.buttons;
  }

  if (options.imageUrl && options.type === 'image') {
    baseOptions.imageUrl = options.imageUrl;
  }
  return new Promise((resolve) => {
    try {
      chrome.notifications.create(notificationId, baseOptions, (id) => {
        if (chrome.runtime.lastError) {
          console.error('Notification error:', chrome.runtime.lastError);
          resolve(null);
        } else {
          // Store notification metadata for click handling
          notificationMap.set(id, options);
          resolve(id);
        }
      });
    } catch (error) {
      resolve(null);
    }
  });
};

/** Scoped public facts use a generic lock-screen message. No account address,
 * transaction amount, guardian address or RPC-supplied text is disclosed.
 */
export const showActivityNotification = async (
  fact: ActivityNotificationFact,
  isCurrent: () => boolean = () => true
): Promise<string | null> => {
  const notify = await getNotificationTranslator();
  if (!isCurrent()) return null;
  const messages: Record<ActivityNotificationFact['kind'], string> = {
    'transaction-pending': 'activityPending',
    'transaction-confirmed': 'activityConfirmed',
    'transaction-failed': 'activityFailed',
    'transaction-status-unknown': 'activityUnknown',
    'recovery-started': 'recoveryStarted',
    'recovery-cancelled': 'recoveryCancelled',
    'recovery-completed': 'recoveryCompleted',
    'recovery-expired': 'recoveryExpired',
    'guardian-policy-changed': 'guardianPolicyChanged',
  };
  return createNotification({
    title: notify('notifications.activityTitle'),
    message: notify(`notifications.${messages[fact.kind]}`),
    isCurrent,
    isClickable: true,
    clickAction: () => openNotificationWallet(isCurrent),
  });
};

// Clear a specific notification
export const clearNotification = (notificationId: string): Promise<boolean> =>
  new Promise((resolve) => {
    chrome.notifications.clear(notificationId, (wasCleared) => {
      notificationMap.delete(notificationId);
      resolve(wasCleared);
    });
  });

// Clear all notifications
export const clearAllNotifications = async (): Promise<void> =>
  new Promise((resolve) => {
    chrome.notifications.getAll((notifications) => {
      const notificationIds = Object.keys(notifications);
      const clearPromises = notificationIds.map((id) => clearNotification(id));
      Promise.all(clearPromises).then(() => resolve());
    });
  });

// Transaction-specific notifications
export const showTransactionNotification = async (
  notification: ITransactionNotification
): Promise<string | null> => {
  const notify = await getNotificationTranslator();
  let title: string;
  let message: string;
  let iconUrl: string;

  // Add transaction type to title if available
  const typeKeys: Record<string, string> = {
    'SPT Transfer': 'notifications.sptTransfer',
    'Bridge to NEVM': 'notifications.bridgeToNevm',
    'Mint from NEVM': 'notifications.mintFromNevm',
    'NEVM Data': 'notifications.nevmData',
    Transaction: 'notifications.transaction',
  };

  switch (notification.type) {
    case 'pending':
      title = notify('notifications.submitted');
      message = notify('notifications.pendingOn', {
        network: notification.network,
      });
      iconUrl = chrome.runtime.getURL('assets/all_assets/favicon-32.png');
      break;

    case 'confirmed':
      title = notify('notifications.confirmed');
      const value =
        notification.value && notification.tokenSymbol
          ? `${notification.value} ${notification.tokenSymbol}`
          : '';
      message = value
        ? notify('notifications.confirmedOn', {
            network: notification.network,
            value,
          })
        : notify('notifications.confirmed');
      iconUrl = chrome.runtime.getURL('assets/all_assets/favicon-32.png');
      break;

    case 'failed':
      title = notify('notifications.failed');
      message = notify('notifications.failedOn', {
        network: notification.network,
      });
      iconUrl = chrome.runtime.getURL('assets/all_assets/favicon-32.png');
      break;

    default:
      return null;
  }

  if (notification.transactionType) {
    const type = Object.prototype.hasOwnProperty.call(
      typeKeys,
      notification.transactionType
    )
      ? notify(typeKeys[notification.transactionType])
      : notification.transactionType;
    title = notify('notifications.typedTitle', { type, title });
  }

  // Shorten addresses for display
  const shortenAddress = (addr: string) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';

  if (notification.from || notification.to) {
    const fromText = notification.from
      ? notify('notifications.fromAddress', {
          address: shortenAddress(notification.from),
        })
      : '';
    const toText = notification.to
      ? notify('notifications.toAddress', {
          address: shortenAddress(notification.to),
        })
      : '';
    message += `\n${fromText}${fromText && toText ? '\n' : ''}${toText}`;
  }

  return createNotification({
    title,
    message,
    iconUrl,
    type: 'basic',
    priority: notification.type === 'failed' ? 2 : 1,
    isClickable: true,
    clickAction: () => openNotificationWallet(),
  });
};

// Network change notification
export const showNetworkChangeNotification = async (
  toNetwork: string
): Promise<string | null> => {
  const notify = await getNotificationTranslator();
  return createNotification({
    title: notify('notifications.networkChanged'),
    message: notify('notifications.switchedTo', { network: toNetwork }),
    type: 'basic',
    priority: 0,
  });
};

// Account change notification
export const showAccountChangeNotification = async (
  newAccount: string,
  accountLabel?: string
): Promise<string | null> => {
  const notify = await getNotificationTranslator();
  const shortenAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  return createNotification({
    title: notify('notifications.accountChanged'),
    message: notify('notifications.activeAccount', {
      account: accountLabel || shortenAddress(newAccount),
    }),
    type: 'basic',
    priority: 0,
  });
};

// Helper function to safely extract hostname from URL or hostname string
const getHostnameFromUrl = (urlOrHostname: string): string => {
  try {
    // Try to create a URL object - if it works, extract hostname
    const url = new URL(urlOrHostname);
    return url.hostname;
  } catch {
    // If URL construction fails, assume it's already a hostname
    // Remove any protocol prefix if present
    return urlOrHostname.replace(/^https?:\/\//, '');
  }
};

// DApp connection notification
export const showDappConnectionNotification = async (
  dappUrl: string,
  approved: boolean
): Promise<string | null> => {
  const notify = await getNotificationTranslator();
  const hostname = getHostnameFromUrl(dappUrl);

  return createNotification({
    title: notify(
      approved
        ? 'notifications.siteConnected'
        : 'notifications.connectionRejected'
    ),
    message: approved
      ? notify('notifications.connectedSite', { hostname })
      : notify('notifications.rejectedSite', { hostname }),
    type: 'basic',
    priority: 1,
  });
};

// Error notification
export const showErrorNotification = async (
  error: string,
  context?: string
): Promise<string | null> => {
  const notify = await getNotificationTranslator();
  return createNotification({
    title: notify('notifications.error'),
    message: context
      ? notify('notifications.errorWithContext', { error, context })
      : notify('notifications.errorDetails', { error }),
    type: 'basic',
    priority: 2,
    requireInteraction: true,
    buttons: [
      {
        title: notify('notifications.viewDetails'),
      },
    ],
  });
};

// Set up notification click handler (call this in background script)
export const setupNotificationListeners = (): void => {
  if (!isNotificationSupported()) return;

  // Handle notification clicks
  chrome.notifications.onClicked.addListener(async (notificationId) => {
    const notification = notificationMap.get(notificationId);
    try {
      if (!notification && !(await isHeldGenericNotice(notificationId, false)))
        return;
      if (!notificationIsCurrent(notification)) return;
      if (notification?.clickUrl) {
        await chrome.tabs.create({ url: notification.clickUrl });
      } else if (notification?.clickAction) {
        await notification.clickAction();
      } else {
        await openNotificationWallet(() => notificationIsCurrent(notification));
      }
    } catch {
      // A custom action must not escape the notification event handler.
    } finally {
      await clearNotification(notificationId);
    }
  });

  // Handle button clicks
  chrome.notifications.onButtonClicked.addListener(async (notificationId) => {
    const notification = notificationMap.get(notificationId);
    try {
      if (
        notification
          ? !notification.buttons
          : !(await isHeldGenericNotice(notificationId, true))
      )
        return;
      if (!notificationIsCurrent(notification)) return;
      await openNotificationWallet(() => notificationIsCurrent(notification));
    } finally {
      await clearNotification(notificationId);
    }
  });

  // Clean up closed notifications from our map
  chrome.notifications.onClosed.addListener((notificationId) => {
    notificationMap.delete(notificationId);
  });
};

// Badge management (number on extension icon)
export const updateBadge = async (
  text: string,
  color?: string
): Promise<void> => {
  if (text) {
    await chrome.action.setBadgeText({ text });
    if (color) {
      await chrome.action.setBadgeBackgroundColor({ color });
    }
  } else {
    await chrome.action.setBadgeText({ text: '' });
  }
};

// Show pending transaction count on badge
export const updatePendingTransactionBadge = async (
  count: number
): Promise<void> => {
  if (count > 0) {
    await updateBadge(count.toString(), '#f59e0b'); // Yellow/orange for pending
  } else {
    await updateBadge(''); // Clear badge
  }
};

// Legacy function for backward compatibility
export const openNotificationsPopup = (
  title: string,
  message: string
): void => {
  createNotification({ title, message });
};
