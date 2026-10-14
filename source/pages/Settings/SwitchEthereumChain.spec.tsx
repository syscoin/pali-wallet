/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';

import { INetworkType } from 'types/network';

import SwitchChain from './SwitchEthereumChain';

const mockEmitter = jest.fn();
const mockDispatch = jest.fn();
const mockWaitForSwitch = jest.fn();
const mockNetwork = {
  chainId: 1,
  kind: INetworkType.Ethereum,
  label: 'Ethereum',
};

jest.mock('hooks/index', () => ({
  useQueryData: () => ({
    host: 'https://bridge.example',
    chainId: 1,
    eventName: 'switch',
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: { activeNetwork: { chainId: 57057, kind: 'ethereum' } },
      vaultGlobal: { networks: { ethereum: { 1: mockNetwork } } },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  Icon: () => null,
  LoadingSvg: () => null,
}));
jest.mock('utils/browser', () => ({
  dispatchBackgroundEvent: (...args: any[]) => mockDispatch(...args),
}));
jest.mock('utils/stateWaitUtils', () => ({
  waitForNetworkSwitch: (...args: any[]) => mockWaitForSwitch(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockResolvedValue(undefined);
  mockWaitForSwitch.mockResolvedValue(undefined);
  jest.spyOn(window, 'close').mockImplementation();
});
afterEach(() => jest.restoreAllMocks());

it('Reject closes the approval without switching or reporting confirmation', () => {
  render(<SwitchChain />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.reject' }));
  expect(window.close).toHaveBeenCalledTimes(1);
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(mockWaitForSwitch).not.toHaveBeenCalled();
});

it('Confirm preserves the ordinary switch and completion sequence', async () => {
  render(<SwitchChain />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'setActiveNetwork'],
    [mockNetwork, false]
  );
  expect(mockWaitForSwitch).toHaveBeenCalledWith(1, 5000);
  expect(mockDispatch).toHaveBeenCalledWith(
    'switch.https://bridge.example',
    null
  );
  expect(mockDispatch.mock.invocationCallOrder[0]).toBeLessThan(
    (window.close as jest.Mock).mock.invocationCallOrder[0]
  );
});

it('keeps both choices disabled while the existing switch is in flight', async () => {
  let finish!: () => void;
  mockEmitter.mockReturnValue(
    new Promise<void>((resolve) => {
      finish = resolve;
    })
  );
  render(<SwitchChain />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  expect(screen.getByRole('button', { name: 'buttons.reject' })).toBeDisabled();
  expect(screen.getAllByRole('button')[1]).toBeDisabled();
  expect(window.close).not.toHaveBeenCalled();
  await act(async () => finish());
  await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
  expect(mockEmitter).toHaveBeenCalledTimes(1);
});

it('a failed switch restores Reject without confirming the approval', async () => {
  mockEmitter.mockRejectedValue(new Error('Synthetic switch failure'));
  jest.spyOn(console, 'error').mockImplementation();
  render(<SwitchChain />);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'buttons.reject' })).toBeEnabled()
  );
  expect(mockDispatch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.reject' }));
  expect(window.close).toHaveBeenCalledTimes(1);
});
