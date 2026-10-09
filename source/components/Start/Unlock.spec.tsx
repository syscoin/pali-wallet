import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { subscribeControllerStatus } from 'hooks/controllerStatus';
import { ProtectedRoute } from 'routers/ProtectedRoute';
import { controllerEmitter } from 'scripts/Background/controllers/controllerEmitter';

import Unlock from './Unlock';

let mockSubmit: (values: { password: string }) => Promise<unknown>;
const mockNavigate = jest.fn();
const mockAlert = { error: jest.fn() };

jest.mock('antd', () => {
  const MockForm = ({ children, onFinish }: any) => {
    mockSubmit = onFinish;
    return children;
  };
  MockForm.Item = ({ children }: any) => children;
  return { Form: MockForm, Input: { Password: () => null } };
});
jest.mock('components/index', () => ({ Button: () => null }));
jest.mock('components/Loader/AppLoadingSkeleton', () => ({
  AppLoadingSkeleton: () => null,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string) => key,
  }),
}));
jest.mock('react-redux', () => ({ useSelector: () => true }));
jest.mock('react-router-dom', () => ({
  Navigate: () => null,
  useLocation: () => ({ hash: '', pathname: '/', search: '' }),
  useNavigate: () => mockNavigate,
}));
jest.mock('hooks/index', () => ({ useQueryData: () => ({}) }));
jest.mock('hooks/useAppReady', () => ({ useAppReady: jest.fn() }));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ alert: mockAlert, navigate: mockNavigate }),
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/navigationState', () => ({ clearNavigationState: jest.fn() }));
jest.mock('utils/index', () => ({
  extractErrorMessage: (error: Error) => error.message,
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: jest.fn(),
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
const renderUnlock = () =>
  renderToStaticMarkup(
    <Unlock
      externalRoute=""
      isExternal={false}
      setIsOpenValidation={jest.fn()}
    />
  );

describe('Unlock authentication navigation', () => {
  let unsubscribe: () => void;
  const previousWindow = global.window;

  beforeEach(() => {
    jest.useFakeTimers();
    chrome.runtime.connect = jest.fn(() => ({
      onDisconnect: { addListener: jest.fn(), removeListener: jest.fn() },
      disconnect: jest.fn(),
    })) as any;
    jest.mocked(controllerEmitter).mockReset();
    mockNavigate.mockClear();
    global.window = { location: { pathname: '/app.html' } } as Window &
      typeof globalThis;
  });
  afterEach(() => {
    unsubscribe?.();
    global.window = previousWindow;
    jest.useRealTimers();
  });

  it('awaits a fresh status before navigation and keeps home protected against an older locked reply', async () => {
    const beforeUnlock = deferred<boolean>();
    const afterUnlock = deferred<boolean>();
    jest
      .mocked(controllerEmitter)
      .mockReturnValueOnce(beforeUnlock.promise)
      .mockResolvedValueOnce(true)
      .mockReturnValueOnce(afterUnlock.promise);
    unsubscribe = subscribeControllerStatus(jest.fn());
    renderUnlock();

    const submitted = mockSubmit({ password: 'correct-password' });
    await flush();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(controllerEmitter).toHaveBeenLastCalledWith(
      ['wallet', 'isUnlocked'],
      [],
      1800,
      false
    );

    afterUnlock.resolve(true);
    await submitted;
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/home');

    beforeUnlock.resolve(false);
    await flush();
    expect(
      renderToStaticMarkup(
        <ProtectedRoute element={<main>Wallet home</main>} />
      )
    ).toBe('<main>Wallet home</main>');
  });

  it('does not navigate on a failed fresh confirmation even if cached status is unlocked', async () => {
    jest
      .mocked(controllerEmitter)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('Worker unavailable'));
    unsubscribe = subscribeControllerStatus(jest.fn());
    await flush();
    renderUnlock();

    await mockSubmit({ password: 'correct-password' });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
