/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import decode from 'jsqr';
import React from 'react';

import { SecretQrImport } from './SecretQrImport';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('jsqr', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('components/Icon/Icon', () => ({ QrcodeOutlined: () => null }));
jest.mock('components/Modal/Modal', () => ({
  Modal: ({ children }) => children,
}));
jest.mock('components/Dialog/Dialog', () => ({
  CenterPanel: ({ children }) => children,
  DialogBody: ({ children }) => children,
  DialogHeader: ({ onClose }: { onClose(): void }) => (
    <button onClick={onClose}>Close</button>
  ),
}));

const getUserMedia = jest.fn();
const stop = jest.fn();
const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  jest.spyOn(document, 'hasFocus').mockReturnValue(true);
  jest
    .spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get')
    .mockReturnValue(640);
  jest
    .spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get')
    .mockReturnValue(480);
  jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        drawImage: jest.fn(),
        getImageData: () => ({ data: new Uint8ClampedArray() }),
      } as unknown as CanvasRenderingContext2D)
  );
});

afterEach(() => {
  jest.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'mediaDevices');
  Reflect.deleteProperty(navigator, 'permissions');
  delete document.documentElement.dataset.paliView;
});

test('offers a wallet tab when the toolbar needs camera permission', async () => {
  document.documentElement.dataset.paliView = 'toolbar-popup';
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: jest.fn().mockResolvedValue({ state: 'prompt' }) },
  });
  chrome.runtime.getURL = (path) => `chrome-extension://test/${path}`;
  render(
    <SecretQrImport kind="recoveryPhrase" restartRecovery onScan={jest.fn()} />
  );
  fireEvent.click(screen.getByRole('button', { name: 'secretQr.scan' }));
  const open = await screen.findByRole('link', { name: 'send.openWalletTab' });
  expect(open.getAttribute('href')).toBe('chrome-extension://test/app.html#/');
  expect(getUserMedia).not.toHaveBeenCalled();
});

test('only supplies a matching scan after the user opens the camera', async () => {
  const onScan = jest.fn();
  const key = `0x${'1'.repeat(64)}`;
  jest
    .mocked(decode)
    .mockReturnValueOnce({ data: `0x${'1'.repeat(40)}` } as ReturnType<
      typeof decode
    >);
  jest
    .mocked(decode)
    .mockReturnValueOnce({ data: key } as ReturnType<typeof decode>);
  getUserMedia.mockResolvedValueOnce(stream);

  render(<SecretQrImport kind="privateKey" onScan={onScan} />);
  expect(getUserMedia).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'secretQr.scan' }));
  await screen.findByText('secretQr.scanInvalid');
  expect(onScan).not.toHaveBeenCalled();
  await waitFor(() => expect(onScan).toHaveBeenCalledWith(key));
  expect(onScan).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
});

test('stops a camera whose permission resolves after the scanner closes', async () => {
  const onScan = jest.fn();
  let grant!: (value: MediaStream) => void;
  getUserMedia.mockReturnValueOnce(
    new Promise((resolve) => {
      grant = resolve;
    })
  );
  render(<SecretQrImport kind="privateNote" onScan={onScan} />);
  fireEvent.click(screen.getByRole('button', { name: 'secretQr.scan' }));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await act(async () => grant(stream));
  expect(stop).toHaveBeenCalledTimes(1);
  expect(decode).not.toHaveBeenCalled();
  expect(onScan).not.toHaveBeenCalled();
});
