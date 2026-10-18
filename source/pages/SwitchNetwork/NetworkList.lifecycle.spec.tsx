/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { dispatchBackgroundEvent } from 'utils/browser';

import { NetworkList } from './NetworkList';

const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockError = jest.fn();
let mockQueryData: Record<string, string> = {};
const firstNetwork = {
  label: 'First network',
  chainId: 57,
  kind: 'syscoin',
  url: 'https://first.invalid',
};
const secondNetwork = {
  label: 'Second network',
  chainId: 5700,
  kind: 'syscoin',
  url: 'https://second.invalid',
};
const mockState = {
  vault: { isBitcoinBased: true, activeNetwork: firstNetwork },
  vaultGlobal: {
    networks: {
      syscoin: { 57: firstNetwork, 5700: secondNetwork },
      ethereum: {},
    },
  },
};

jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: { error: mockError } }),
}));
jest.mock('hooks/index', () => ({ useQueryData: () => mockQueryData }));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <svg /> }));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => <span /> }));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('./NetworkInfo', () => ({
  useNetworkInfo: () => ({
    leftLogo: () => <span />,
    rightLogo: () => <span />,
  }),
}));

const deferred = () => {
  let resolve!: (value?: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const selectAndConnect = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByTitle('Second network'));
  await user.click(screen.getByRole('button', { name: 'buttons.connect' }));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockQueryData = {};
  jest.spyOn(console, 'error').mockImplementation();
  jest.spyOn(window, 'close').mockImplementation();
});
afterEach(() => jest.restoreAllMocks());

it('navigates after the current picker successfully commits the selected network', async () => {
  const pending = deferred();
  mockEmitter.mockReturnValueOnce(pending.promise);
  render(<NetworkList />);
  await selectAndConnect();
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'setActiveNetwork'],
    [secondNetwork, false]
  );
  expect(mockNavigate).not.toHaveBeenCalled();
  await act(async () => pending.resolve());
  expect(mockNavigate).toHaveBeenCalledWith('/home');
});

it('keeps a failed current picker retryable and displays its error', async () => {
  mockEmitter
    .mockRejectedValueOnce(new Error('Endpoint unavailable'))
    .mockResolvedValueOnce(undefined);
  render(<NetworkList />);
  await selectAndConnect();
  expect(mockError).toHaveBeenCalledWith('Endpoint unavailable');
  expect(screen.getByRole('button', { name: 'buttons.connect' })).toBeEnabled();
  await userEvent.click(
    screen.getByRole('button', { name: 'buttons.connect' })
  );
  expect(mockNavigate).toHaveBeenCalledWith('/home');
});

it('does not redirect a later page after the pending picker has unmounted', async () => {
  const pending = deferred();
  mockEmitter.mockReturnValueOnce(pending.promise);
  const view = render(<NetworkList />);
  await selectAndConnect();
  view.unmount();
  await act(async () => pending.resolve());
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('does not alert a later page after the pending picker has unmounted', async () => {
  const pending = deferred();
  mockEmitter.mockReturnValueOnce(pending.promise);
  const view = render(<NetworkList />);
  await selectAndConnect();
  view.unmount();
  await act(async () => pending.reject(new Error('Old endpoint failed')));
  expect(mockError).not.toHaveBeenCalled();
});

it('finishes a current forced switch through its original popup response', async () => {
  mockQueryData = { host: 'https://dapp.invalid', eventName: 'switch' };
  const pending = deferred();
  mockEmitter.mockReturnValueOnce(pending.promise);
  render(<NetworkList isTypeSwitch />);
  await selectAndConnect();
  await act(async () => pending.resolve());
  expect(dispatchBackgroundEvent).toHaveBeenCalledWith(
    'switch.https://dapp.invalid',
    null
  );
  expect(window.close).toHaveBeenCalledTimes(1);
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('does not complete or close an abandoned forced-switch popup', async () => {
  mockQueryData = { host: 'https://dapp.invalid', eventName: 'switch' };
  const pending = deferred();
  mockEmitter.mockReturnValueOnce(pending.promise);
  const view = render(<NetworkList isTypeSwitch />);
  await selectAndConnect();
  view.unmount();
  await act(async () => pending.resolve());
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(window.close).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
});
