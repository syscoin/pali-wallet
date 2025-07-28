import { i18next } from 'utils/i18n';

import { checkIfPopupIsOpen } from './checkPopupOpen';

export interface INotificationOptions {
  buttons?: Array<{
    title: string;
  }>;
  clickAction?: () => void;
  clickUrl?: string;
  eventTime?: number;
  iconUrl?: string;
  imageUrl?: string;
  isClickable?: boolean;
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
  // e.g., "SPT Transfer", "SYS → SYSX", "Bridge to NEVM"
  metadata?: any;
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
  if (popupOpen && !options.requireInteraction) {
    return null;
  }
  const notificationId = `pali_${Date.now()}_${Math.random()
    .toString(36)
    .substring(7)}`;

  const baseOptions: any = {
    type: options.type || 'basic',
    iconUrl:
      options.iconUrl ||
      chrome.runtime.getURL('assets/all_assets/favicon-48.png'),
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
  // Check if i18next is initialized, but don't wait
  if (!i18next.isInitialized) {
    console.warn(
      '[Notifications] i18next not initialized, using fallback text'
    );
    // Use fallback English text immediately
    return createNotification({
      title:
        notification.type === 'pending'
          ? 'Transaction Submitted'
          : notification.type === 'confirmed'
          ? 'Transaction Confirmed'
          : 'Transaction Failed',
      message: `Transaction ${notification.type} on ${notification.network}`,
      iconUrl: chrome.runtime.getURL('assets/all_assets/favicon-48.png'),
      type: 'basic',
      priority: notification.type === 'failed' ? 2 : 1,
      isClickable: true,
      buttons: [
        {
          title: 'Click to view details',
        },
      ],
    });
  }

  let title: string;
  let message: string;
  let iconUrl: string;

  // Add transaction type to title if available
  const titlePrefix = notification.transactionType
    ? `${notification.transactionType}: `
    : '';

  switch (notification.type) {
    case 'pending':
      title = titlePrefix + i18next.t('notifications.transactionSubmitted');
      message = i18next.t('notifications.transactionPending', {
        network: notification.network,
      });
      iconUrl = chrome.runtime.getURL('assets/all_assets/favicon-48.png');
      break;

    case 'confirmed':
      title = titlePrefix + i18next.t('notifications.transactionConfirmed');
      const value =
        notification.value && notification.tokenSymbol
          ? `${notification.value} ${notification.tokenSymbol}`
          : '';
      message = value
        ? i18next.t('notifications.transactionConfirmedValue', {
            network: notification.network,
            value: value,
          })
        : i18next.t('notifications.transactionConfirmed');
      iconUrl = chrome.runtime.getURL('assets/all_assets/favicon-48.png');
      break;

    case 'failed':
      title = titlePrefix + i18next.t('notifications.transactionFailed');
      message = i18next.t('notifications.transactionFailedOn', {
        network: notification.network,
      });
      iconUrl = chrome.runtime.getURL('assets/all_assets/favicon-48.png');
      break;

    default:
      return null;
  }

  // Shorten addresses for display
  const shortenAddress = (addr: string) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : '';

  if (notification.from || notification.to) {
    const fromText = notification.from
      ? `From: ${shortenAddress(notification.from)}`
      : '';
    const toText = notification.to
      ? `To: ${shortenAddress(notification.to)}`
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
    clickAction: () => {
      // Open wallet when notification is clicked
      chrome.action.openPopup();
    },
  });
};

// Network change notification
export const showNetworkChangeNotification = async (
  fromNetwork: string,
  toNetwork: string
): Promise<string | null> => {
  // Check if i18next is initialized, but don't wait
  if (!i18next.isInitialized) {
    console.warn(
      '[Notifications] i18next not initialized for network change, using fallback text'
    );
    return createNotification({
      title: 'Network Changed',
      message: `Switched from ${fromNetwork} to ${toNetwork}`,
      type: 'basic',
      priority: 0,
    });
  }

  return createNotification({
    title: i18next.t('notifications.networkChanged'),
    message: i18next.t('notifications.switchedNetwork', {
      fromNetwork,
      toNetwork,
    }),
    type: 'basic',
    priority: 0,
  });
};

// Account change notification
export const showAccountChangeNotification = async (
  newAccount: string,
  accountLabel?: string
): Promise<string | null> => {
  const shortenAddress = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  // Check if i18next is initialized, but don't wait
  if (!i18next.isInitialized) {
    console.warn(
      '[Notifications] i18next not initialized for account change, using fallback text'
    );
    return createNotification({
      title: 'Account Changed',
      message: `Active account: ${accountLabel || shortenAddress(newAccount)}`,
      type: 'basic',
      priority: 0,
    });
  }

  return createNotification({
    title: i18next.t('notifications.accountChanged'),
    message: i18next.t('notifications.activeAccount', {
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
  const hostname = getHostnameFromUrl(dappUrl);

  // Check if i18next is initialized, but don't wait
  if (!i18next.isInitialized) {
    console.warn(
      '[Notifications] i18next not initialized for dapp connection, using fallback text'
    );
    return createNotification({
      title: approved ? 'Site Connected' : 'Connection Rejected',
      message: approved
        ? `${hostname} is now connected to Pali Wallet`
        : `Connection request from ${hostname} was rejected`,
      type: 'basic',
      priority: 1,
    });
  }

  return createNotification({
    title: approved
      ? i18next.t('notifications.siteConnected')
      : i18next.t('notifications.connectionRejected'),
    message: approved
      ? i18next.t('notifications.connectedTo', {
          dappUrl: hostname,
        })
      : i18next.t('notifications.rejectedFrom', {
          dappUrl: hostname,
        }),
    type: 'basic',
    priority: 1,
  });
};

// Error notification
export const showErrorNotification = async (
  error: string,
  context?: string
): Promise<string | null> => {
  // Check if i18next is initialized, but don't wait
  if (!i18next.isInitialized) {
    console.warn(
      '[Notifications] i18next not initialized for error notification, using fallback text'
    );
    return createNotification({
      title: 'Error',
      message: context
        ? `An error occurred: ${error}: ${context}`
        : `An error occurred: ${error}`,
      type: 'basic',
      priority: 2,
      requireInteraction: true,
      buttons: [
        {
          title: 'Click to view details',
        },
      ],
    });
  }

  return createNotification({
    title: i18next.t('buttons.error'),
    message: context
      ? i18next.t('notifications.errorOccurred', {
          message: `${error}: ${context}`,
        })
      : i18next.t('notifications.errorOccurred', { message: error }),
    type: 'basic',
    priority: 2,
    requireInteraction: true,
    buttons: [
      {
        title: i18next.t('notifications.clickToView'),
      },
    ],
  });
};

// Set up notification click handler (call this in background script)
export const setupNotificationListeners = (): void => {
  if (!isNotificationSupported()) return;

  // Handle notification clicks
  chrome.notifications.onClicked.addListener((notificationId) => {
    const notification = notificationMap.get(notificationId);

    if (notification) {
      if (notification.clickUrl) {
        chrome.tabs.create({ url: notification.clickUrl });
      } else if (notification.clickAction) {
        notification.clickAction();
      } else {
        // Default action: open the wallet
        chrome.action.openPopup();
      }
    }

    // Clear the notification after click
    clearNotification(notificationId);
  });

  // Handle button clicks
  chrome.notifications.onButtonClicked.addListener((notificationId) => {
    const notification = notificationMap.get(notificationId);

    if (notification && notification.buttons) {
      // Handle button action - for now, just open the popup
      chrome.action.openPopup();
    }

    clearNotification(notificationId);
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
