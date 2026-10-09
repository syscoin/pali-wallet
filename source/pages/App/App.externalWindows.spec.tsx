import React from 'react';

import { hasExternalWalletPage } from 'utils/extensionContexts';

import App from './App';

jest.mock('components/index', () => ({ Container: 'container' }));
jest.mock('components/Loader/AppLoadingSkeleton', () => ({
  AppLoadingSkeleton: 'skeleton',
}));
jest.mock('components/WalletErrorBoundary/WalletErrorBoundary', () => ({
  __esModule: true,
  default: 'error-boundary',
}));
jest.mock('routers/index', () => ({ Router: 'router' }));
jest.mock('react-router-dom', () => ({
  HashRouter: 'hash-router',
  useNavigate: () => jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('utils/extensionContexts', () => ({
  ...jest.requireActual('utils/extensionContexts'),
  hasExternalWalletPage: jest.fn(),
}));

describe('main wallet external view lifecycle', () => {
  const originalChrome = global.chrome;
  let slots: any[];
  let cursor: number;
  let cleanup: (() => void) | undefined;
  let setup: (() => void | (() => void)) | undefined;
  let dependencies: any[] | undefined;
  const removed = jest.fn();
  const updated = jest.fn();
  const storageChanged = jest.fn();
  const render = () => {
    cursor = 0;
    const view = App({});
    if (setup) {
      const pending = setup;
      setup = undefined;
      cleanup?.();
      cleanup = pending() || undefined;
    }
    return view as React.ReactElement;
  };
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  const viewName = () => (render().type as any).name;

  beforeEach(() => {
    slots = [];
    cursor = 0;
    cleanup = undefined;
    setup = undefined;
    dependencies = undefined;
    removed.mockReset();
    updated.mockReset();
    storageChanged.mockReset();
    (hasExternalWalletPage as jest.Mock).mockReset();
    global.chrome = {
      runtime: {
        id: 'pali',
        getURL: (path: string) => `chrome-extension://pali${path}`,
      },
      storage: {
        onChanged: { addListener: storageChanged, removeListener: jest.fn() },
      },
      tabs: {
        onRemoved: { addListener: removed, removeListener: jest.fn() },
        onUpdated: { addListener: updated, removeListener: jest.fn() },
      },
    } as unknown as typeof chrome;
    jest.spyOn(React, 'useState').mockImplementation((initial?: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value: any) => {
          slots[index] =
            typeof value === 'function' ? value(slots[index]) : value;
        },
      ] as any;
    });
    jest.spyOn(React, 'useRef').mockImplementation((initial: any) => {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    });
    jest.spyOn(React, 'useEffect').mockImplementation((effect, deps) => {
      if (dependencies?.every((value, i) => Object.is(value, deps?.[i])))
        return;
      dependencies = deps as any[];
      setup = effect;
    });
  });

  afterEach(() => {
    cleanup?.();
    jest.restoreAllMocks();
    global.chrome = originalChrome;
  });

  it('recovers after an abrupt external tab close without a storage update', async () => {
    (hasExternalWalletPage as jest.Mock).mockResolvedValueOnce(true);
    render();
    await flush();
    expect(viewName()).toBe('ExternalActiveMessage');

    (hasExternalWalletPage as jest.Mock).mockResolvedValueOnce(false);
    removed.mock.calls[0][0](17, { isWindowClosing: true, windowId: 3 });
    await flush();

    expect(hasExternalWalletPage).toHaveBeenCalledTimes(2);
    expect(viewName()).toBe('MainApp');
    expect(storageChanged).toHaveBeenCalledTimes(1);
  });

  it('does not interrupt the main wallet for unrelated browser tab events', async () => {
    (hasExternalWalletPage as jest.Mock).mockResolvedValue(false);
    render();
    await flush();
    expect(viewName()).toBe('MainApp');

    removed.mock.calls[0][0](18, {});
    updated.mock.calls[0][0](
      19,
      { status: 'complete' },
      { url: 'https://example.com' }
    );
    updated.mock.calls[0][0](19, { url: 'https://example.org' }, {});

    expect(hasExternalWalletPage).toHaveBeenCalledTimes(1);
    expect(viewName()).toBe('MainApp');
  });

  it('blocks the main wallet when a newly created external tab is still loading', async () => {
    (hasExternalWalletPage as jest.Mock).mockResolvedValueOnce(false);
    render();
    await flush();
    (hasExternalWalletPage as jest.Mock).mockResolvedValueOnce(true);

    updated.mock.calls[0][0](
      19,
      { status: 'loading' },
      {
        pendingUrl:
          'chrome-extension://pali/external.html?route=settings/account/hardware',
      }
    );
    await flush();

    expect(viewName()).toBe('ExternalActiveMessage');
  });

  it('refreshes the main wallet guard for its Firefox pending external tab', async () => {
    chrome.runtime.getURL = (path) => `moz-extension://internal-uuid${path}`;
    (hasExternalWalletPage as jest.Mock).mockResolvedValueOnce(false);
    render();
    await flush();
    updated.mock.calls[0][0](
      19,
      {},
      { pendingUrl: 'moz-extension://other-uuid/external/sign-eth' }
    );
    expect(hasExternalWalletPage).toHaveBeenCalledTimes(1);
    (hasExternalWalletPage as jest.Mock).mockResolvedValueOnce(true);
    updated.mock.calls[0][0](
      19,
      {},
      { pendingUrl: 'moz-extension://internal-uuid/external/sign-eth' }
    );
    await flush();
    expect(viewName()).toBe('ExternalActiveMessage');
  });
});
