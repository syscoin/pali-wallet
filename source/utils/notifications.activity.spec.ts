import en from 'assets/locales/en.json';

import { checkIfPopupIsOpen } from './checkPopupOpen';
import {
  setupNotificationListeners,
  showActivityNotification,
} from './notifications';

jest.mock('./checkPopupOpen', () => ({ checkIfPopupIsOpen: jest.fn() }));
const create = jest.fn((id, _options, done) => done(id));
const onClicked = jest.fn();
const openPopup = jest.fn();
const fact = {
  key: 'scope:recovery',
  kind: 'recovery-completed' as const,
  direction: 'unknown' as const,
  evidence: 'observed-state' as const,
  scope: {
    accountAddress: `0x${'11'.repeat(20)}`,
    accountId: '0',
    accountType: 'SmartAccount',
    chainId: '1',
    networkKey: 'https://private-endpoint.example',
    networkType: 'evm' as const,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  (chrome.storage.local.get as jest.Mock).mockImplementation((_keys, done) =>
    done({ language: 'en' })
  );
  Object.assign(chrome, {
    notifications: {
      create,
      clear: jest.fn((_id, done) => done(true)),
      onClicked: { addListener: onClicked },
      onButtonClicked: { addListener: jest.fn() },
      onClosed: { addListener: jest.fn() },
    },
    action: { openPopup },
  });
  Object.assign(chrome.runtime, {
    getURL: (path: string) => `chrome-extension://test/${path}`,
  });
  (checkIfPopupIsOpen as jest.Mock).mockResolvedValue(false);
});

it('uses only fixed lifecycle text and opens the wallet without exposing account metadata', async () => {
  await showActivityNotification(fact);
  const options = create.mock.calls[0][1];
  expect(options.title).toBe(en.notifications.activityTitle);
  expect(options.message).toBe(en.notifications.recoveryCompleted);
  expect(JSON.stringify(options)).not.toContain(fact.scope.accountAddress);
  expect(JSON.stringify(options)).not.toContain(fact.scope.networkKey);
});

it('rechecks the wallet scope after asynchronous popup detection', async () => {
  let current = true;
  (checkIfPopupIsOpen as jest.Mock).mockImplementation(async () => {
    current = false;
    return false;
  });
  expect(await showActivityNotification(fact, () => current)).toBeNull();
  expect(create).not.toHaveBeenCalled();
});

it('does not route a stale account notification after the selected account changes', async () => {
  let current = true;
  const id = await showActivityNotification(fact, () => current);
  setupNotificationListeners();
  current = false;
  onClicked.mock.calls[0][0](id);
  expect(openPopup).not.toHaveBeenCalled();
});

it('opens the wallet for a notification whose account scope is still current', async () => {
  const id = await showActivityNotification(fact, () => true);
  setupNotificationListeners();
  onClicked.mock.calls[0][0](id);
  expect(openPopup).toHaveBeenCalledTimes(1);
});
