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
import SwitchUtxoEvm from './SwitchNetworkUtxoEvm';

const mockEmitter = jest.fn();
const mockDispatch = jest.fn();
const mockWaitForSwitch = jest.fn();
let mockActiveNetwork: any;
const target = {
  chainId: 5700,
  kind: INetworkType.Ethereum,
  label: 'Target network',
  url: 'https://target.invalid',
};
const mockQuery = {
  host: 'https://requesting.invalid',
  chainId: target.chainId,
  newNetwork: target,
  newChainValue: INetworkType.Ethereum,
  eventName: 'switch',
};

jest.mock('hooks/index', () => ({ useQueryData: () => mockQuery }));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: {
        activeNetwork: mockActiveNetwork,
      },
      vaultGlobal: { networks: { ethereum: { 5700: target } } },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const messages = jest.requireActual('../../assets/locales/en.json');
      return (
        key.split('.').reduce((entry: any, part) => entry?.[part], messages) ||
        key
      );
    },
  }),
}));
jest.mock('components/ChainIcon', () => ({
  ChainIcon: ({ chainId, networkKind, size }: any) => (
    <svg
      data-testid="network-icon"
      data-chain-id={chainId}
      data-network-kind={networkKind}
      data-size={size}
    />
  ),
}));
jest.mock('components/Icon/Icon', () => ({
  Icon: () => null,
  LoadingSvg: () => null,
}));
jest.mock('components/index', () => ({
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  Button: jest.requireActual('components/Button/Button').Button,
}));
jest.mock('utils/browser', () => ({
  dispatchBackgroundEvent: (...args: any[]) => mockDispatch(...args),
}));
jest.mock('utils/stateWaitUtils', () => ({
  waitForNetworkSwitch: (...args: any[]) => mockWaitForSwitch(...args),
}));

const deferred = () => {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockReset().mockResolvedValue(undefined);
  mockWaitForSwitch.mockReset().mockResolvedValue(undefined);
  mockActiveNetwork = {
    chainId: 57,
    kind: INetworkType.Syscoin,
    label: 'Original network',
  };
  jest.spyOn(window, 'close').mockImplementation();
  jest.spyOn(console, 'error').mockImplementation();
});
afterEach(() => jest.restoreAllMocks());

describe.each([
  {
    label: 'Ethereum',
    Component: SwitchChain,
    confirmLabel: 'Confirm',
    rejectLabel: 'Reject',
  },
  {
    label: 'UTXO/EVM',
    Component: SwitchUtxoEvm,
    confirmLabel: 'Change',
    rejectLabel: 'Cancel',
  },
])(
  '$label switch approval feedback',
  ({ label, Component, confirmLabel, rejectLabel }) => {
    const confirm = () =>
      fireEvent.click(screen.getByRole('button', { name: confirmLabel }));

    it('preserves the exact network badge markup and icon inputs', () => {
      render(<Component />);
      const badge =
        'px-1.5 py-0.5 text-[10px] font-medium text-white rounded-full';
      expect(screen.getByText('UTXO').outerHTML).toBe(
        `<span class="${badge} bg-brand-pink">UTXO</span>`
      );
      expect(screen.getByText('EVM').outerHTML).toBe(
        `<span class="${badge} bg-brand-blue">EVM</span>`
      );
      const icons = screen.getAllByTestId('network-icon');
      expect(icons[0]).toHaveAttribute('data-chain-id', '57');
      expect(icons[0]).toHaveAttribute(
        'data-network-kind',
        INetworkType.Syscoin
      );
      expect(icons[1]).toHaveAttribute('data-chain-id', '5700');
      expect(icons[1]).toHaveAttribute('data-network-kind', target.kind);
      for (const icon of icons)
        expect(icon).toHaveAttribute(
          'data-size',
          label === 'Ethereum' ? '100' : '18'
        );
    });

    it('keeps the original network snapshot after Redux replaces the active network', () => {
      const view = render(<Component />);
      mockActiveNetwork = {
        chainId: 1337,
        kind: INetworkType.Ethereum,
        label: 'Different network',
      };
      view.rerender(<Component />);
      const previousIcon = screen.getAllByTestId('network-icon')[0];
      expect(previousIcon).toHaveAttribute('data-chain-id', '57');
      expect(previousIcon).toHaveAttribute(
        'data-network-kind',
        INetworkType.Syscoin
      );
      expect(screen.getByText('UTXO')).toHaveClass('bg-brand-pink');
      if (label === 'UTXO/EVM') {
        expect(
          screen.getByText('Original network', { exact: false })
        ).toBeVisible();
        expect(
          screen.queryByText('Different network', { exact: false })
        ).toBeNull();
      }
    });

    it('retains primitive chain identity even if a stale network object is mutated', () => {
      const view = render(<Component />);
      mockActiveNetwork.chainId = 1337;
      mockActiveNetwork.kind = INetworkType.Ethereum;
      view.rerender(<Component />);
      const previousIcon = screen.getAllByTestId('network-icon')[0];
      expect(previousIcon).toHaveAttribute('data-chain-id', '57');
      expect(previousIcon).toHaveAttribute(
        'data-network-kind',
        INetworkType.Syscoin
      );
      expect(screen.getByText('UTXO')).toHaveClass('bg-brand-pink');
    });

    it('reports a rejected switch, clears the error on retry and closes only after success', async () => {
      const retry = deferred();
      mockEmitter
        .mockRejectedValueOnce(new Error('Target endpoint is unavailable'))
        .mockReturnValueOnce(retry.promise);
      render(<Component />);
      confirm();
      const error = await screen.findByRole('alert');
      expect(error).toHaveTextContent('Target endpoint is unavailable');
      expect(error.parentElement).not.toHaveClass('absolute');
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(window.close).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: rejectLabel })).toBeEnabled();

      confirm();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByRole('button', { name: confirmLabel })).toBeDisabled();
      expect(screen.getByRole('button', { name: rejectLabel })).toBeDisabled();
      await act(async () => retry.resolve());
      await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
      expect(mockEmitter).toHaveBeenCalledTimes(2);
      expect(mockDispatch).toHaveBeenCalledTimes(1);
    });

    it('uses a translated fallback for a rejected controller result without a message', async () => {
      mockEmitter.mockRejectedValueOnce({ code: 'RPC_UNAVAILABLE' });
      render(<Component />);
      confirm();
      expect(await screen.findByRole('alert')).toHaveTextContent('Failed');
      expect(screen.getByRole('button', { name: confirmLabel })).toBeEnabled();
      expect(screen.getByRole('button', { name: rejectLabel })).toBeEnabled();
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(window.close).not.toHaveBeenCalled();
    });

    it('keeps Cancel or Reject available after a transport timeout without confirming', async () => {
      mockEmitter.mockRejectedValueOnce(new Error('Network request timed out'));
      render(<Component />);
      confirm();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Network request timed out'
      );
      fireEvent.click(screen.getByRole('button', { name: rejectLabel }));
      expect(window.close).toHaveBeenCalledTimes(1);
      expect(mockEmitter).toHaveBeenCalledTimes(1);
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(mockWaitForSwitch).not.toHaveBeenCalled();
    });

    it('preserves the successful switch acknowledgement and close sequence', async () => {
      render(<Component />);
      confirm();
      await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'setActiveNetwork'],
        [target, false]
      );
      expect(mockWaitForSwitch).toHaveBeenCalledWith(target.chainId, 5000);
      expect(mockDispatch).toHaveBeenCalledWith(
        'switch.https://requesting.invalid',
        null
      );
      expect(mockDispatch.mock.invocationCallOrder[0]).toBeLessThan(
        (window.close as jest.Mock).mock.invocationCallOrder[0]
      );
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('preserves best-effort view synchronization after the network mutation succeeds', async () => {
      mockWaitForSwitch.mockRejectedValueOnce(new Error('View update delayed'));
      render(<Component />);
      confirm();
      await waitFor(() => expect(window.close).toHaveBeenCalledTimes(1));
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('does not apply an old popup rejection to a newly opened approval', async () => {
      const old = deferred();
      mockEmitter.mockReturnValueOnce(old.promise);
      const previous = render(<Component />);
      confirm();
      previous.unmount();
      render(<Component />);
      await act(async () => old.reject(new Error('Earlier popup failed')));
      expect(screen.queryByRole('alert')).toBeNull();
      expect(screen.getByRole('button', { name: confirmLabel })).toBeEnabled();
      expect(screen.getByRole('button', { name: rejectLabel })).toBeEnabled();
      expect(mockDispatch).not.toHaveBeenCalled();
      expect(window.close).not.toHaveBeenCalled();
    });

    it('rejects an untouched approval without starting a switch', () => {
      render(<Component />);
      fireEvent.click(screen.getByRole('button', { name: rejectLabel }));
      expect(window.close).toHaveBeenCalledTimes(1);
      expect(mockEmitter).not.toHaveBeenCalled();
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  }
);
