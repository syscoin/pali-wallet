/** @jest-environment jsdom */

export {};

jest.mock('./backgroundMessaging', () => ({
  sendToBackground: jest.fn((_message, callback) =>
    callback({ isInjected: true })
  ),
}));

const page = window as any;
let receive: (...args: any[]) => unknown;

beforeEach(() => {
  jest.clearAllMocks();
  delete page.__paliContentScriptInitialized;
  window.history.replaceState(null, '', '/supported.html');
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  (chrome.runtime as any).getURL = jest.fn(
    (file) => `chrome-extension://fixture/${file}`
  );
  (chrome.runtime as any).onMessage = {
    addListener: jest.fn(),
    removeListener: jest.fn(),
  };
  jest.isolateModules(() => require('./index'));
  receive = (chrome.runtime.onMessage.addListener as jest.Mock).mock
    .calls[0][0];
  document.head.innerHTML = '';
});

it.each([
  ['pali_addProperty', 'inpage', 'js/inpage.bundle.js'],
  [
    'pali_removeProperty',
    'removeProperty',
    'js/handleWindowProperties.bundle.js',
  ],
])(
  'receives the background %s notification through the normal content listener',
  (method, id, file) => {
    receive(
      { id: method, data: { method, params: { type: method } } },
      {},
      jest.fn()
    );
    expect(document.getElementById(id)?.getAttribute('src')).toBe(
      `chrome-extension://fixture/${file}`
    );
  }
);

it.each(['/unsupported.pdf', '/unsupported.xml'])(
  'does not inject a newly toggled provider into an unsupported document %s',
  (pathname) => {
    window.history.replaceState(null, '', pathname);
    receive(
      {
        id: 'pali_addProperty',
        data: {
          method: 'pali_addProperty',
          params: { type: 'pali_addProperty' },
        },
      },
      {},
      jest.fn()
    );
    expect(document.getElementById('inpage')).toBeNull();
  }
);
