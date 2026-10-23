import { readFileSync } from 'fs';
import { join } from 'path';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import es from 'assets/locales/es.json';
import fr from 'assets/locales/fr.json';
import ja from 'assets/locales/ja.json';
import ko from 'assets/locales/ko.json';
import pt from 'assets/locales/pt.json';
import ru from 'assets/locales/ru.json';
import zh from 'assets/locales/zh.json';

import { checkIfPopupIsOpen } from './checkPopupOpen';
import { getNotificationTranslator } from './notificationLocale';
import {
  showAccountChangeNotification,
  showDappConnectionNotification,
  showErrorNotification,
  showNetworkChangeNotification,
  showTransactionNotification,
} from './notifications';

jest.mock('./checkPopupOpen', () => ({ checkIfPopupIsOpen: jest.fn() }));

const locales = { en, es, pt, fr, de, zh, ja, ko, ru };
let language: unknown;
const create = jest.fn((id, _options, callback) => callback(id));
beforeEach(() => {
  jest.clearAllMocks();
  language = 'en';
  (chrome.storage.local.get as jest.Mock).mockImplementation(
    (_keys, callback) => callback({ language })
  );
  Object.assign(chrome.runtime, {
    getURL: (path: string) => `chrome-extension://synthetic/${path}`,
  });
  Object.assign(chrome, { notifications: { create } });
  (checkIfPopupIsOpen as jest.Mock).mockResolvedValue(false);
});

it.each(Object.keys(locales))(
  '%s uses the saved wallet language and preserves public metadata',
  async (lng) => {
    language = lng;
    const catalog = locales[lng as keyof typeof locales].notifications;
    const network = 'Loopback A&B <fixture>';
    await showNetworkChangeNotification(network);
    expect(create.mock.calls.at(-1)![1]).toMatchObject({
      title: catalog.networkChanged,
      message: catalog.switchedTo.replace('{{network}}', network),
      priority: 1,
    });
    // Existing createNotification priority/default behavior is intentionally unchanged.
    await showAccountChangeNotification('0x' + '11'.repeat(20), 'Public A&B');
    expect(create.mock.calls.at(-1)![1]).toMatchObject({
      title: catalog.accountChanged,
      message: catalog.activeAccount.replace('{{account}}', 'Public A&B'),
    });
    await showDappConnectionNotification(
      'https://example.invalid/public',
      true
    );
    expect(create.mock.calls.at(-1)![1]).toMatchObject({
      title: catalog.siteConnected,
      message: catalog.connectedSite.replace('{{hostname}}', 'example.invalid'),
    });
    await showDappConnectionNotification('https://example.invalid', false);
    expect(create.mock.calls.at(-1)![1]).toMatchObject({
      title: catalog.connectionRejected,
      message: catalog.rejectedSite.replace('{{hostname}}', 'example.invalid'),
    });
    for (const type of ['pending', 'confirmed', 'failed'] as const) {
      await showTransactionNotification({
        type,
        network,
        chainId: 31337,
        txHash: '0x' + 'aa'.repeat(32),
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222',
        value: '1.25',
        tokenSymbol: 'A&B',
        transactionType: 'SPT Transfer',
      });
      const options = create.mock.calls.at(-1)![1];
      expect(options.title).toBe(
        catalog.typedTitle
          .replace('{{type}}', catalog.sptTransfer)
          .replace(
            '{{title}}',
            catalog[type === 'pending' ? 'submitted' : type]
          )
      );
      expect(options.message).toContain(network);
      expect(options.message).toContain(
        catalog.fromAddress.replace('{{address}}', '0x1111...1111')
      );
      expect(options.message).toContain(
        catalog.toAddress.replace('{{address}}', '0x2222...2222')
      );
      expect(options.priority).toBe(type === 'failed' ? 2 : 1);
      if (type === 'confirmed') expect(options.message).toContain('1.25 A&B');
    }
    await showErrorNotification('RPC A&B {{network}}', 'public fixture');
    const options = create.mock.calls.at(-1)![1];
    expect(options.title).toBe(catalog.error);
    expect(options.message).toBe(
      catalog.errorWithContext
        .replace('{{error}}', 'RPC A&B {{network}}')
        .replace('{{context}}', 'public fixture')
    );
    expect(options.buttons).toEqual([{ title: catalog.viewDetails }]);
    expect(options.requireInteraction).toBe(true);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  }
);

it('reads a new saved choice for the next notification, rather than pinning startup English', async () => {
  language = 'fr';
  await showNetworkChangeNotification('Loopback');
  expect(create.mock.calls.at(-1)![1].title).toBe(
    fr.notifications.networkChanged
  );
  language = 'de';
  await showNetworkChangeNotification('Loopback');
  expect(create.mock.calls.at(-1)![1].title).toBe(
    de.notifications.networkChanged
  );
});

it.each([undefined, null, 7, {}, 'unsupported', '__proto__', 'constructor'])(
  'falls back safely for invalid saved locale %p',
  async (invalid) => {
    language = invalid;
    const notify = await getNotificationTranslator();
    expect(notify('notifications.networkChanged')).toBe(
      en.notifications.networkChanged
    );
    expect(notify('notifications.__proto__')).toBe('notifications.__proto__');
    expect(notify('notifications.constructor')).toBe(
      'notifications.constructor'
    );
  }
);

it('retains popup suppression, unsupported notifications and storage-read failure fallback', async () => {
  (checkIfPopupIsOpen as jest.Mock).mockResolvedValue(true);
  expect(await showNetworkChangeNotification('Loopback')).toBeNull();
  expect(create).not.toHaveBeenCalled();
  (checkIfPopupIsOpen as jest.Mock).mockResolvedValue(false);
  (chrome.storage.local.get as jest.Mock).mockImplementation(() => {
    throw Error('Synthetic preference read failure');
  });
  await showNetworkChangeNotification('Loopback');
  expect(create.mock.calls.at(-1)![1].title).toBe(
    en.notifications.networkChanged
  );
  delete (chrome as any).notifications;
  expect(await showNetworkChangeNotification('Loopback')).toBeNull();
});

it('builds only worker notification catalogs, retaining exact translation fields and values', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const loader = require('../config/loaders/notificationLocale');
  for (const lng of Object.keys(locales)) {
    const source = readFileSync(
      join(__dirname, '../assets/locales', `${lng}.json`),
      'utf8'
    );
    const projected = JSON.parse(loader(source));
    expect(Object.keys(projected)).toEqual(['notifications']);
    expect(projected.notifications).toEqual(
      locales[lng as keyof typeof locales].notifications
    );
    expect(projected).not.toHaveProperty('send');
    expect(projected).not.toHaveProperty('settings');
  }
  expect(() => loader('{}')).toThrow('Missing notification translations');
  expect(() => loader('{"notifications":{"nested":{}}}')).toThrow(
    'Notification translations must be text'
  );
});
