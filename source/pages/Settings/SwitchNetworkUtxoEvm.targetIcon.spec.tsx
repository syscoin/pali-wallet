/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';

let mockState: any;
let mockQuery: any;
const mockPopup = jest.fn();
const mockControllerEmitter = jest.fn();
jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('scripts/Background', () => ({
  getController: () => ({ dapp: { get: () => null } }),
}));
jest.mock(
  'scripts/Background/controllers/message-handler/method-handlers',
  () => ({
    clearProviderCache: jest.fn(),
  })
);
jest.mock(
  'scripts/Background/controllers/message-handler/popup-promise',
  () => ({
    popupPromise: (...args: any[]) => mockPopup(...args),
  })
);
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('hooks/index', () => ({ useQueryData: () => mockQuery }));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockControllerEmitter }),
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockControllerEmitter(...args),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/index', () => ({
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  Button: ({ children }: React.PropsWithChildren) => (
    <button>{children}</button>
  ),
}));
jest.mock('components/Icon/Icon', () => ({
  BtcChainSvg: () => <svg data-testid="chain-symbol" data-coin="bitcoin" />,
  EthChainSvg: () => <svg data-testid="chain-symbol" data-coin="ethereum" />,
  SysChainSvg: () => <svg data-testid="chain-symbol" data-coin="syscoin" />,
  ChainFallbackSvg: () => (
    <svg data-testid="chain-symbol" data-coin="fallback" />
  ),
  RolluxChainSvg: () => <svg data-testid="chain-symbol" data-coin="rollux" />,
}));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));

import { getMethodConfig } from 'scripts/Background/controllers/message-handler/method-registry';
import {
  requestCoordinator,
  utxoEvmSwitchMiddleware,
} from 'scripts/Background/controllers/message-handler/request-pipeline';
import { MethodRoute } from 'scripts/Background/controllers/message-handler/types';
import { INetworkType } from 'types/network';

import SwitchNetworkUtxoEvm from './SwitchNetworkUtxoEvm';

const syscoin = {
  kind: INetworkType.Syscoin,
  chainId: 57,
  slip44: 57,
  label: 'Syscoin',
  url: 'https://syscoin.synthetic.invalid',
};
const ethereum = {
  kind: INetworkType.Ethereum,
  chainId: 1,
  slip44: 60,
  label: 'Ethereum',
  url: 'https://ethereum.synthetic.invalid',
};
const bitcoin = {
  kind: INetworkType.Syscoin,
  chainId: 0,
  slip44: 0,
  label: 'Bitcoin',
  url: 'https://bitcoin.synthetic.invalid',
};
const bitcoinTestnet = {
  kind: INetworkType.Syscoin,
  chainId: 1,
  slip44: 1,
  label: 'Bitcoin Testnet',
  url: 'https://bitcoin-testnet.synthetic.invalid',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPopup.mockResolvedValue(null);
  // Execute the real middleware's chosen popup callback; this test renders the
  // resulting approval data, not a hand-authored alternate route payload.
  jest
    .spyOn(requestCoordinator, 'coordinatePopupRequest')
    .mockImplementation(async (_context, open) => open());
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it.each([
  {
    method: 'eth_changeUTXOEVM',
    previous: bitcoinTestnet,
    target: ethereum,
    expectedIcon: 'ethereum',
  },
  {
    method: 'sys_changeUTXOEVM',
    previous: ethereum,
    target: bitcoinTestnet,
    expectedIcon: 'bitcoin',
  },
  {
    method: 'sys_switchChain',
    previous: ethereum,
    target: bitcoin,
    expectedIcon: 'bitcoin',
  },
  {
    method: 'sys_changeUTXOEVM',
    previous: ethereum,
    target: syscoin,
    expectedIcon: 'syscoin',
  },
] as const)(
  '$method from $previous.label to $target.label renders the real target-family icon',
  async ({ method, previous, target, expectedIcon }) => {
    mockState = {
      vault: {
        activeNetwork: previous,
        isBitcoinBased: previous.kind === INetworkType.Syscoin,
      },
      vaultGlobal: {
        networks: {
          ethereum: { 1: ethereum },
          syscoin: { 0: bitcoin, 1: bitcoinTestnet, 57: syscoin },
        },
      },
    };
    const config = getMethodConfig(method);
    expect(config).toBeDefined();
    const next = jest.fn(async () => null);
    await utxoEvmSwitchMiddleware(
      {
        originalRequest: {
          method,
          host: 'https://dapp.synthetic.invalid',
          params: [{ chainId: target.chainId }],
        },
        methodConfig: config,
      } as any,
      next
    );
    expect(mockPopup).toHaveBeenCalledTimes(1);
    const popup = mockPopup.mock.calls[0][0];
    expect(popup.route).toBe(MethodRoute.SwitchUtxoEvm);
    expect(popup.data.newNetwork).toEqual(target);
    expect(popup.data.newChainValue).toBe(target.kind);
    expect(next).toHaveBeenCalledTimes(1);
    mockQuery = { ...popup.data, host: popup.host, eventName: popup.eventName };
    render(<SwitchNetworkUtxoEvm />);
    expect(screen.getByText(target.label)).toBeVisible();
    const icons = screen.getAllByTestId('chain-symbol');
    expect(icons).toHaveLength(2);
    // The real ChainIcon selects these SVG leaves. In particular, numeric 1
    // must mean Ethereum or Bitcoin Testnet according to the target family.
    expect(icons[1]).toHaveAttribute('data-coin', expectedIcon);
    expect(mockControllerEmitter).not.toHaveBeenCalled();
  }
);
