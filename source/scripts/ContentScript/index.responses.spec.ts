/** @jest-environment jsdom */

import { sendToBackground } from './backgroundMessaging';
import { BaseProvider } from './inject/BaseProvider';

jest.mock('./backgroundMessaging', () => ({
  sendToBackground: jest.fn(),
}));

let backgroundResult: unknown;
let postMessage: jest.SpyInstance;
let provider: BaseProvider;

beforeAll(() => {
  (chrome.runtime as any).getURL = jest.fn(
    (file) => `chrome-extension://fixture/${file}`
  );
  (chrome.runtime as any).onMessage = {
    addListener: jest.fn(),
    removeListener: jest.fn(),
  };
  (sendToBackground as jest.Mock).mockImplementation((message, callback) => {
    callback(
      message.type === 'METHOD_REQUEST'
        ? backgroundResult
        : { isInjected: false }
    );
  });
  jest.isolateModules(() => require('./index'));
  postMessage = jest
    .spyOn(window, 'postMessage')
    .mockImplementation((data: any) => {
      window.dispatchEvent(
        new MessageEvent('message', { data, source: window })
      );
    });
  provider = new BaseProvider('ethereum');
});

afterAll(() => postMessage.mockRestore());

it.each([
  ['false', false],
  ['zero', 0],
  ['empty string', ''],
  ['pending null', null],
  ['array', ['0x1234']],
  ['object', { syncing: true }],
])(
  'preserves the %s RPC result across the actual content/page bridge',
  async (_label, result) => {
    backgroundResult = result;
    await expect(provider.request({ method: 'fixture_read' })).resolves.toEqual(
      result
    );
  }
);

it('preserves a numeric RPC error across the actual content/page bridge', async () => {
  const error = { code: -32602, message: 'Invalid fixture parameters' };
  backgroundResult = { error };
  await expect(provider.request({ method: 'fixture_read' })).rejects.toEqual(
    error
  );
});
