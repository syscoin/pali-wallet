/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions":["node","node-addons"]}
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getAddress } from 'ethers';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import {
  clearProviderCache,
  EthMethodHandler,
} from '../../scripts/Background/controllers/message-handler/method-handlers';
import { getMethodConfig } from '../../scripts/Background/controllers/message-handler/method-registry';
import { popupPromise } from '../../scripts/Background/controllers/message-handler/popup-promise';
import { requestCoordinator } from '../../scripts/Background/controllers/message-handler/request-pipeline';
import { getController } from 'scripts/Background';
import { EthProvider } from 'scripts/Provider/EthProvider';
import { SysProvider } from 'scripts/Provider/SysProvider';
import { createTemporaryAlarm } from 'utils/alarmUtils';
import { dispatchBackgroundEvent } from 'utils/browser';
import { getPersonalSignParams } from 'utils/personalSignReview';

import EthSign from './SignEth';

const ADDRESS = getAddress('0x8ba1f109551bd432803012645ac136ddd64dba72');
const HOST = 'https://sign-review.example';
const MESSAGE = 'Review this public test message.';
const HEX_MESSAGE = `0x${Buffer.from(MESSAGE).toString('hex')}`;
const OTHER_ADDRESS = `0x${'22'.repeat(20)}`;
const mockTranslate = (key: string) => key;
const mockEmitter = jest.fn();
const mockCopy = jest.fn();
const mockAlert = { error: jest.fn(), info: jest.fn(), success: jest.fn() };
const mockConnectedAccount = jest.fn();
const mockIsUnlocked = jest.fn();
let mockState: any;

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockState },
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('hooks/index', () => ({
  useQueryData: jest.requireActual('hooks/useQuery').useQueryData,
  useUtils: () => ({
    alert: mockAlert,
    useCopyClipboard: () => [false, mockCopy],
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('scripts/Provider/EthProvider', () => ({ EthProvider: jest.fn() }));
jest.mock('scripts/Provider/SysProvider', () => ({ SysProvider: jest.fn() }));
jest.mock(
  'scripts/Background/controllers/message-handler/popup-promise',
  () => ({
    popupPromise: jest.fn(),
  })
);
jest.mock(
  'scripts/Background/controllers/message-handler/request-pipeline',
  () => ({
    requestCoordinator: { coordinatePopupRequest: jest.fn() },
  })
);
jest.mock(
  'scripts/Background/controllers/message-handler/sendCallsBundles',
  () => ({})
);
jest.mock('utils/alarmUtils', () => ({ createTemporaryAlarm: jest.fn() }));
jest.mock('utils/browser', () => ({ dispatchBackgroundEvent: jest.fn() }));
jest.mock('utils/errorHandling', () => ({ handleTransactionError: jest.fn() }));
jest.mock('utils/network', () => ({ getNetworkChain: () => 'ethereum' }));
jest.mock('utils/smartAccount', () => ({}));
jest.mock('components/Loading', () => ({
  LoadingComponent: () => null,
  PqSigningOverlay: () => null,
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <svg /> }));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  ErrorModal: ({ show, log }: any) =>
    show ? <div role="alert">{log}</div> : null,
  WarningModal: () => null,
  DeviceWaitingBanner: () => null,
  Icon: () => null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  clearProviderCache();
  const account = {
    id: 0,
    type: 'HDAccount',
    address: ADDRESS,
    balances: { ethereum: '1' },
    label: 'Public review account',
  };
  mockState = {
    vault: {
      accounts: { HDAccount: { 0: account } },
      activeAccount: { type: 'HDAccount', id: 0 },
      activeNetwork: { currency: 'ETH', chainId: 1 },
      isBitcoinBased: false,
    },
  };
  mockConnectedAccount.mockImplementation((host) => {
    if (host !== HOST) throw new Error(`Unexpected account read: ${host}`);
    return account;
  });
  mockIsUnlocked.mockReturnValue(true);
  jest.mocked(getController).mockReturnValue({
    dapp: { getAccount: mockConnectedAccount },
    wallet: { isUnlocked: mockIsUnlocked },
  } as any);
  mockEmitter.mockImplementation(async (path) => {
    throw new Error(`Unexpected controller call: ${path.join('.')}`);
  });
  for (const provider of [EthProvider, SysProvider]) {
    jest.mocked(provider).mockImplementation(() => {
      throw new Error('No provider calls are allowed during local review');
    });
  }
  jest.spyOn(window, 'close').mockImplementation(() => undefined);
});

afterEach(() => {
  // Merely inspecting Data must never submit, cancel, copy or open another prompt.
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(EthProvider).not.toHaveBeenCalled();
  expect(SysProvider).not.toHaveBeenCalled();
  expect(popupPromise).not.toHaveBeenCalled();
  expect(requestCoordinator.coordinatePopupRequest).not.toHaveBeenCalled();
  expect(dispatchBackgroundEvent).not.toHaveBeenCalled();
  expect(createTemporaryAlarm).not.toHaveBeenCalled();
  expect(mockCopy).not.toHaveBeenCalled();
  expect(window.close).not.toHaveBeenCalled();
  jest.restoreAllMocks();
});

// Use the real local eth_accounts handler, including its connected/unlocked checks
// and casing, rather than inventing a dapp's requested signer from a fixture.
const getDisclosedAddress = async () => {
  const config = getMethodConfig('eth_accounts');
  if (!config) throw new Error('eth_accounts registry entry missing');
  const accounts = await new EthMethodHandler().handle({
    methodConfig: config,
    originalRequest: {
      host: HOST,
      method: 'eth_accounts',
      params: [],
      sender: { tab: { id: 1 } } as chrome.runtime.MessageSender,
      type: 'METHOD_REQUEST',
    },
  });
  expect(accounts).toEqual([ADDRESS.toLowerCase()]);
  expect(accounts[0]).not.toBe(ADDRESS);
  expect(mockIsUnlocked).toHaveBeenCalledTimes(1);
  expect(mockConnectedAccount).toHaveBeenCalledWith(HOST);
  return accounts[0] as string;
};

it.each([
  ['canonical plain text', 'canonical', MESSAGE, MESSAGE],
  ['canonical byte-encoded text', 'canonical', HEX_MESSAGE, MESSAGE],
  ['unambiguous same-case legacy', 'legacy-same', MESSAGE, MESSAGE],
  [
    'canonical other address-shaped message',
    'canonical',
    OTHER_ADDRESS,
    OTHER_ADDRESS,
  ],
  ['unambiguous lowercased legacy', 'legacy-disclosed', MESSAGE, MESSAGE],
  ['canonical active-address-shaped message', 'canonical', ADDRESS, ADDRESS],
])(
  'keeps the real Data interpretation aligned with personal_sign parsing: %s',
  async (_name, order, payload, preview) => {
    const disclosedAddress = await getDisclosedAddress();
    const params =
      order === 'legacy-same'
        ? [ADDRESS, payload]
        : order === 'legacy-disclosed'
        ? [disclosedAddress, payload]
        : [payload, disclosedAddress];
    const expectedAddress =
      order === 'legacy-same' ? ADDRESS : disclosedAddress;
    const request = {
      host: HOST,
      eventName: 'personal_sign',
      0: params[0],
      1: params[1],
    };
    const serialized = JSON.stringify(request);
    expect(getPersonalSignParams(request)).toEqual({
      address: expectedAddress,
      message: payload,
    });
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter
        initialEntries={[
          `/external/eth-sign?data=${encodeURIComponent(serialized)}`,
        ]}
      >
        <EthSign />
      </MemoryRouter>
    );
    const dataButton = await screen.findByRole('button', { name: 'send.data' });
    const confirm = screen.getByRole('button', { name: 'buttons.confirm' });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelector('p.font-mono')?.textContent).toBe(preview);

    // Activate the actual Data button with a native keyboard event, not a mocked
    // render callback, then compare exact unmodified raw bytes and parsed rows.
    dataButton.focus();
    expect(document.activeElement).toBe(dataButton);
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByText('send.parameterInterpretation')).toBeTruthy()
    );
    expect(document.activeElement).toBe(dataButton);
    expect(
      Array.from(container.querySelectorAll('pre'), (pre) => pre.textContent)
    ).toEqual(params);
    expect(JSON.stringify(request)).toBe(serialized);
    const interpretation = screen.getByText('send.parameterInterpretation')
      .parentElement!.parentElement!;
    const rowValue = (label: string | RegExp) =>
      within(interpretation).getByText(label).parentElement!.lastElementChild!
        .textContent;
    expect({
      address: rowValue('send.address'),
      message: rowValue(/^send\.message:/),
    }).toEqual({ address: expectedAddress, message: payload });
  }
);
