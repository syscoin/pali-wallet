import { handleMasterControllerResponses } from './handleMasterControllerResponses';

describe('controller action sender authorization', () => {
  const addListener = chrome.runtime.onMessage.addListener as jest.Mock;
  const lock = jest.fn().mockResolvedValue('locked');
  const sendResponse = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(chrome.runtime, {
      getURL: jest.fn(
        (path = '') => `chrome-extension://pali-extension/${path}`
      ),
      id: 'pali-extension',
    });

    handleMasterControllerResponses({ wallet: { lock } } as any);
  });

  const getListener = () => addListener.mock.calls[0][0];

  it('rejects controller actions relayed from a file page', () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const result = getListener()(
      {
        data: { methods: ['wallet', 'lock'], params: [] },
        type: 'CONTROLLER_ACTION',
      },
      {
        id: 'pali-extension',
        tab: { id: 1 },
        url: 'file:///tmp/malicious.html',
      },
      sendResponse
    );

    expect(result).toBe(false);
    expect(lock).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith({
      error: 'Controller actions are not available from connected sites',
      success: false,
    });
    consoleError.mockRestore();
  });

  it('preserves controller actions from extension pages', async () => {
    const result = getListener()(
      {
        data: { methods: ['wallet', 'lock'], params: [] },
        type: 'CONTROLLER_ACTION',
      },
      {
        id: 'pali-extension',
        url: 'chrome-extension://pali-extension/app.html',
      },
      sendResponse
    );

    expect(result).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lock).toHaveBeenCalledTimes(1);
    expect(sendResponse).toHaveBeenCalledWith('locked');
  });
});
