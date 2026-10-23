/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { Provider } from 'react-redux';

import type SysAccountController from 'scripts/Background/controllers/account/syscoin';
import vault, {
  createAccount,
  setAccountPropertyByIdAndType,
  setNetworkChange,
} from 'state/vault';
import vaultGlobal, { setActiveSlip44 } from 'state/vaultGlobal';
import { initialActiveHdAccountState, KeyringAccountType } from 'types/network';
import type { ITokenSysProps } from 'types/tokens';
import { getSyscoinUTXOTestnetNetwork } from 'utils/defaultNetworks';

import { SendSys } from './SendSys';

let mockStore: any;
const mockLocation = { pathname: '/send/sys', state: null };
const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
const mockSave = jest.fn();
const mockAlert = { error: jest.fn(), success: jest.fn() };

jest.mock('state/store', () => ({
  __esModule: true,
  default: { getState: () => mockStore.getState() },
}));
jest.mock('scripts/Background', () => ({ getController: jest.fn() }));
jest.mock('react-router-dom', () => ({ useLocation: () => mockLocation }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/controllerStatus', () => ({
  getControllerStatus: () => ({
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    isUnlocked: true,
    isLoading: false,
    connectionUnavailable: false,
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ alert: mockAlert, navigate: mockNavigate }),
}));
// Use the package's real CJS color helpers so Jest can load the real registry
// SVG. No glyph, form, selection or layout result is replaced.
jest.mock('@ant-design/colors', () =>
  jest.requireActual('@ant-design/colors/lib')
);
jest.mock('@ant-design/colors/es/generate', () =>
  jest.requireActual('@ant-design/colors/lib/generate')
);
jest.mock('components/Icon/Icon', () => ({
  PaliWhiteSmallIconSvg: () => null,
  ArrowDownSvg: jest.requireActual('components/Icon/Icon').ArrowDownSvg,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  Fee: () => null,
  Icon: () => null,
  Tooltip: ({ children }: any) => <>{children}</>,
}));
jest.mock('jdenticon', () => ({ toSvg: () => '<svg></svg>' }));
jest.mock('utils/navigationState', () => ({
  ...jest.requireActual('utils/navigationState'),
  saveNavigationState: (...args: any[]) => mockSave(...args),
}));
jest.mock('utils/index', () => ({
  ...jest.requireActual('utils/format'),
  ...jest.requireActual('utils/navigationState'),
  ...jest.requireActual('utils/removeScientificNotation'),
  isNFT: jest.requireActual('utils/isNft').isNFT,
  getAssetBalance: jest.requireActual('utils/transactions').getAssetBalance,
  MINIMUM_FEE: 0.00000001,
}));
jest.mock('utils/validations', () => ({
  isValidSYSAddress: () => Promise.resolve(true),
}));
jest.mock('utils/errorHandling', () => ({
  handleTransactionError: () => false,
}));

const NETWORK = {
  ...getSyscoinUTXOTestnetNetwork(),
  url: 'https://blockbook.synthetic.invalid/',
};
const PUBLIC_ACCOUNT = {
  ...initialActiveHdAccountState,
  id: 0,
  label: 'Public SPT selection fixture',
  address: 'tsys1qmk2wr58dse5esyw8xcrsp7k5r77zj2xzvhqhkl',
  xpub: 'tpubDF93avGi4A5M9SVXQ45xy1hJ5j7dEBkA4M9jTwt74wurbFoCfRSHoDshkoLaUQmobjYGSakehWisjK6CXHeB3fXwtCtPmGnrKnvEU6u8NwV',
};
const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;

beforeAll(() => {
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  }));
});
afterAll(() => {
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/app.html');
  mockSave.mockResolvedValue(undefined);
  mockStore = configureStore({ reducer: { vault, vaultGlobal } });
  mockStore.dispatch(setActiveSlip44(1));
  mockStore.dispatch(setNetworkChange({ activeNetwork: NETWORK }));
  mockStore.dispatch(
    createAccount({
      accountType: KeyringAccountType.HDAccount,
      account: PUBLIC_ACCOUNT,
    })
  );
  mockStore.dispatch(
    setAccountPropertyByIdAndType({
      id: PUBLIC_ACCOUNT.id,
      type: KeyringAccountType.HDAccount,
      property: 'balances',
      value: { syscoin: '1.25', ethereum: '0' },
    })
  );
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'getRecommendedFee') return 0.00000001;
    if (method === 'refreshActiveAccountBalances') return undefined;
    throw new Error(`Unexpected controller operation: ${method}`);
  });
});
afterEach(() => {
  cleanup();
  expect(mockAlert.error).not.toHaveBeenCalled();
  expect(
    mockNavigate.mock.calls.every(
      ([route, options]) => route === '/send/sys' && options?.replace === true
    )
  ).toBe(true);
  expect(
    mockEmitter.mock.calls.every(([[, method]]) =>
      ['getRecommendedFee', 'refreshActiveAccountBalances'].includes(method)
    )
  ).toBe(true);
});

// The actual account importer and Redux reducer establish the same public
// records produced by successful SPT import. Discovery/HTTP reachability is
// independently covered by the root-owned browser probe; no controller result,
// selected-asset state, menu DOM or accessibility state is injected here.
const addAssets = async (
  symbols: [string, string],
  balances: [string, string] = ['2.5', '2.5'],
  guids: [string, string] = ['123', '456']
) => {
  const createController = jest.requireActual(
    'scripts/Background/controllers/account/syscoin'
  ).default as typeof SysAccountController;
  const account = createController(() => {
    throw new Error('No keyring/signing operation is allowed');
  });
  for (const [index, assetGuid] of guids.entries()) {
    const token: ITokenSysProps = {
      assetGuid,
      chainId: NETWORK.chainId,
      symbol: symbols[index],
      name: symbols[index],
      balance: balances[index],
      decimals: index === 0 ? 2 : 8,
      type: 'SPTAllocated',
    };
    const mutation = await account.prepareTokenAddition(token);
    mockStore.dispatch(mutation());
  }
  expect(
    mockStore
      .getState()
      .vault.accountAssets.HDAccount[0].syscoin.map(
        (token: ITokenSysProps) => token.assetGuid
      )
  ).toEqual(guids);
};
const mount = async () => {
  const user = userEvent.setup();
  await act(async () =>
    render(
      <Provider store={mockStore}>
        <SendSys />
      </Provider>
    )
  );
  return user;
};
const trigger = () =>
  screen
    .getAllByRole('button')
    .find((button) => button.getAttribute('aria-haspopup') === 'menu')!;
const amount = () =>
  screen.getByPlaceholderText('send.amount') as HTMLInputElement;
const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(trigger());
  const menu = screen.getByRole('menu');
  await waitFor(() => expect(menu).toHaveFocus());
  return menu;
};
const assetOptions = () => {
  const options = screen.getAllByRole('menuitem');
  expect(options).toHaveLength(3);
  expect(options[0]).toHaveTextContent('SYS');
  for (const option of options) {
    expect(option.tagName).toBe('BUTTON');
    expect(option).toHaveAttribute('type', 'button');
  }
  return options.slice(1);
};
const savedGuid = () => {
  const states = mockSave.mock.calls.map((call) => call[2]);
  return states.at(-1)?.selectedAsset?.assetGuid ?? null;
};
const expectSavedGuid = async (guid: string | null) =>
  waitFor(() => expect(savedGuid()).toBe(guid));
const expectCollapsedLayout = (symbol: string) => {
  const button = trigger();
  expect(button).toHaveAccessibleName(symbol);
  expect(button).toHaveClass('w-[100px]', 'gap-2', 'px-3');
  expect(button.querySelector('p')).toHaveClass(
    'min-w-0',
    'flex-1',
    'truncate'
  );
  expect(button.querySelector('p')).toHaveTextContent(symbol);
  const arrow = button.querySelector('svg');
  expect(arrow).toHaveAttribute('viewBox', '0 0 24 25');
  expect(arrow).toHaveAttribute('width', '24');
  expect(arrow).toHaveAttribute('height', '25');
  expect(arrow).toHaveClass('shrink-0');
};
const semantics = (option: HTMLElement) => {
  let name = '';
  let description = '';
  // Use Testing Library's public role query rather than adding a dependency
  // on its internal accessibility implementation.
  screen.getByRole('menuitem', {
    name: (value, element) => {
      if (element === option) name = value;
      return element === option;
    },
  });
  screen.getByRole('menuitem', {
    description: (value, element) => {
      if (element === option) description = value;
      return element === option;
    },
  });
  return {
    text: option.textContent?.replace(/\s+/g, ' ').trim(),
    name,
    description,
    // Also retain aria-description because the installed query implementation
    // predates this attribute. Root's browser probe checks actual Chromium AX.
    ariaDescription: option.getAttribute('aria-description'),
    title: option.getAttribute('title'),
  };
};
// Preserve Headless UI's own Escape/focus lifecycle without relying on the
// jsdom frame clock or mutating the menu's selected/accessibility state.
const finishEscape = async (user: ReturnType<typeof userEvent.setup>) => {
  const callbacks = new Map<number, FrameRequestCallback>();
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  let id = 0;
  const request = jest
    .spyOn(window, 'requestAnimationFrame')
    .mockImplementation((callback) => {
      callbacks.set(--id, callback);
      return id;
    });
  const cancel = jest
    .spyOn(window, 'cancelAnimationFrame')
    .mockImplementation((handle) => {
      if (!callbacks.delete(handle)) nativeCancel(handle);
    });
  try {
    await user.keyboard('{Escape}');
    for (let frame = 0; frame < 2; frame += 1) {
      const pending = [...callbacks.values()];
      callbacks.clear();
      await act(async () =>
        pending.forEach((callback) => callback(performance.now()))
      );
    }
    expect(callbacks.size).toBe(0);
  } finally {
    cancel.mockRestore();
    request.mockRestore();
  }
};

it('healthy unique-symbol controls retain exact GUID selection and token/native MAX', async () => {
  await addAssets(['SPTONE', 'SPTTWO'], ['2.5', '0.00000001']);
  const user = await mount();
  await open(user);
  const [first, second] = assetOptions();
  expect(semantics(first)).not.toEqual(semantics(second));
  await user.click(first);
  await expectSavedGuid('123');
  await user.click(screen.getByRole('button', { name: 'send.max' }));
  expect(amount().value).toBe('2.5');
  await open(user);
  await user.click(assetOptions()[1]);
  await expectSavedGuid('456');
  await user.click(screen.getByRole('button', { name: 'send.max' }));
  expect(amount().value).toBe('0.00000001');
  await open(user);
  await user.click(screen.getAllByRole('menuitem')[0]);
  await expectSavedGuid(null);
  await user.click(screen.getByRole('button', { name: 'send.max' }));
  expect(amount().value).toBe('1.25');
});

it.each(['DUP', 'ABCDEFGH1', 'VERYLONGTOKEN123456789'])(
  'reserves the actual collapsed icon while preserving full SPT name and selection for %s',
  async (symbol) => {
    await addAssets([symbol, 'PEER']);
    const user = await mount();
    expectCollapsedLayout(NETWORK.currency);
    await open(user);
    await user.click(assetOptions()[0]);
    await expectSavedGuid('123');
    expectCollapsedLayout(symbol);
    await user.click(screen.getByRole('button', { name: 'send.max' }));
    expect(amount().value).toBe('2.5');
  }
);

it('healthy same-symbol controls still select the exact GUID with pointer and native keyboard', async () => {
  await addAssets(['DUP', 'DUP']);
  const user = await mount();
  await open(user);
  await user.click(assetOptions()[1]);
  await expectSavedGuid('456');
  await user.click(screen.getByRole('button', { name: 'send.max' }));
  expect(amount().value).toBe('2.5');
  const menu = await open(user);
  await user.keyboard('{Home}{ArrowDown}');
  expect(
    document.getElementById(menu.getAttribute('aria-activedescendant')!)
  ).toBe(assetOptions()[0]);
  await user.keyboard('{Enter}');
  await expectSavedGuid('123');
  await user.click(screen.getByRole('button', { name: 'send.max' }));
  expect(amount().value).toBe('2.5');
});

it('healthy Escape leaves the previous exact GUID and manual amount unchanged', async () => {
  await addAssets(['DUP', 'DUP']);
  const user = await mount();
  await open(user);
  await user.click(assetOptions()[1]);
  await expectSavedGuid('456');
  await user.type(amount(), '1.23');
  const menu = await open(user);
  await user.keyboard('{Home}{ArrowDown}');
  expect(
    document.getElementById(menu.getAttribute('aria-activedescendant')!)
  ).toBe(assetOptions()[0]);
  await finishEscape(user);
  await waitFor(() => expect(trigger()).toHaveFocus());
  expect(screen.queryByRole('menu')).toBeNull();
  expect(amount().value).toBe('1.23');
  await expectSavedGuid('456');
});

it('healthy uint64 maximum GUID remains complete in the visible and accessible menu identity', async () => {
  const guid = '18446744073709551615';
  await addAssets(['MAXID', 'PEER'], ['7', '2.5'], [guid, '123']);
  const user = await mount();
  await open(user);
  const [maximum] = assetOptions();
  expect(maximum).toHaveTextContent(guid);
  expect(semantics(maximum).name).toContain(guid);
  expect(maximum).toHaveTextContent('NFT');
});

it.each([
  ['same symbol', ['DUP', 'DUP']],
  ['same truncated prefix', ['ABCDEFGH1', 'ABCDEFGH2']],
] as const)(
  'distinct fungible SPT GUIDs expose distinct choice identity for %s',
  async (_case, symbols) => {
    await addAssets([...symbols]);
    const user = await mount();
    await open(user);
    const [first, second] = assetOptions();
    const choices = [semantics(first), semantics(second)];
    console.info('spt_send_choice_identity=' + JSON.stringify(choices));
    // Names, visible text, descriptions and hover titles all count as identity
    // cues. Missing aria-* alone is not a failure, nor are opaque DOM IDs.
    expect(choices[0]).not.toEqual(choices[1]);
  }
);
