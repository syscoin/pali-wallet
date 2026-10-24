/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import en from 'assets/locales/en.json';
import fr from 'assets/locales/fr.json';
import vaultGlobalReducer, { setNetwork } from 'state/vaultGlobal';
import { INetwork, INetworkType } from 'types/network';

import { NetworkMenu } from './NetworkMenu';

// Mount the real Headless UI Menu, native controls, ChainIcon and local glyphs.
// Only the surrounding store hooks and controller transport are finite mocks;
// browser qualification separately proves durable registry and no-grant state.
const mockEmitter = jest.fn();
const mockDispatch = jest.fn();
const mockNavigate = jest.fn();
const mockChainLookup = jest.fn();
let mockState: any;
let mockLanguage: 'en' | 'fr' = 'en';
const originalFetch = global.fetch;
const SHARED_LABEL = 'Shared test network';
const IDS = [5, 11155111] as const;

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home', search: '', hash: '', state: {} }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) => {
      const catalog = jest.requireActual(
        mockLanguage === 'fr'
          ? 'assets/locales/fr.json'
          : 'assets/locales/en.json'
      );
      const message = key
        .split('.')
        .reduce((entry: any, part) => entry?.[part], catalog);
      return typeof message === 'string'
        ? message.replace(/{{(\w+)}}/g, (_match, name) =>
            String(values[name] ?? '')
          )
        : key;
    },
    i18n: { language: mockLanguage },
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('state/store', () => ({
  __esModule: true,
  default: {
    getState: () => mockState,
    dispatch: (...args: any[]) => mockDispatch(...args),
  },
}));
jest.mock('scripts/Background/controllers/controllerEmitter', () => ({
  controllerEmitter: (...args: any[]) => mockChainLookup(...args),
}));
// Preserve the installed glyph implementation under standard Jest's CJS entry.
jest.mock('@ant-design/colors/es/generate', () =>
  jest.requireActual('@ant-design/colors/lib/generate')
);
jest.mock('components/index', () => ({
  Icon: jest.requireActual('components/Icon/Icon').Icon,
}));
jest.mock('components/Spinner/Spinner', () => ({
  __esModule: true,
  default: () => <span data-testid="header-loading" />,
}));

const active: INetwork = {
  chainId: 1,
  kind: INetworkType.Ethereum,
  slip44: 60,
  label: 'Active control',
  currency: 'eth',
  url: 'https://active.synthetic.invalid',
};
const choice = (chainId: number, label = SHARED_LABEL): INetwork => ({
  ...active,
  chainId,
  label,
  // Deliberately synthetic credential/query values must not become UI identity.
  url: `https://rpc-user:rpc-password@rpc-${chainId}.synthetic.invalid/private?apiKey=rpc-secret-${chainId}`,
  apiUrl: `https://explorer.synthetic.invalid/api?apikey=explorer-secret-${chainId}`,
  key: `registry-secret-${chainId}`,
});
const catalog = () => (mockLanguage === 'fr' ? fr : en);
const familyName = (kind = INetworkType.Ethereum) =>
  kind === INetworkType.Syscoin
    ? catalog().networkMenu.utxoNetworks
    : catalog().networkMenu.evmNetworks;
const identity = (chainId: number, label = SHARED_LABEL) =>
  `${label} (EVM · ${catalog().settings.chainNumber.replace(
    '{{chainId}}',
    String(chainId)
  )})`;

beforeEach(() => {
  jest.clearAllMocks();
  mockLanguage = 'en';
  mockEmitter.mockResolvedValue(undefined);
  mockChainLookup.mockImplementation(() => {
    throw new Error('Known local icons must not request chain metadata');
  });
  global.fetch = jest.fn(async () => {
    throw new Error('No network allowed in mounted menu proof');
  });
  mockState = {
    vault: { activeNetwork: active, isBitcoinBased: false },
    vaultGlobal: {
      advancedSettings: { refresh: false },
      networkStatus: 'idle',
      networks: {
        syscoin: {
          57: {
            chainId: 57,
            kind: INetworkType.Syscoin,
            slip44: 57,
            label: 'UTXO control',
            currency: 'sys',
            url: 'https://utxo.synthetic.invalid',
          },
        },
        ethereum: {
          1: active,
          5: choice(5),
          11155111: choice(11155111),
        },
      },
    },
    dapp: { dapps: {} },
  };
});
afterEach(() => {
  cleanup();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(mockChainLookup).not.toHaveBeenCalled();
  expect(mockDispatch).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(mockState.dapp.dapps).toEqual({});
  global.fetch = originalFetch;
});

const openMenu = async () => {
  const user = userEvent.setup();
  const view = render(<NetworkMenu />);
  const trigger = screen.getByRole('button');
  await user.click(trigger);
  const menu = screen.getByRole('menu');
  await user.click(
    within(menu).getByRole('menuitem', {
      name: familyName(),
    })
  );
  const group = within(menu).getByRole('group', {
    name: familyName(),
  });
  return { user, view, trigger, menu, group };
};
const expectActive = async (menu: HTMLElement, item: HTMLElement) => {
  await waitFor(() =>
    expect(menu).toHaveAttribute('aria-activedescendant', item.id)
  );
  expect(menu).toHaveFocus();
};
const reachWithKeys = async (
  user: ReturnType<typeof userEvent.setup>,
  menu: HTMLElement,
  target: HTMLElement
) => {
  const enabled = Array.from(
    menu.querySelectorAll<HTMLElement>('[role="menuitem"]')
  ).filter((item) => item.getAttribute('aria-disabled') !== 'true');
  const index = enabled.indexOf(target);
  expect(index).toBeGreaterThanOrEqual(0);
  await user.keyboard('{Home}');
  await expectActive(menu, enabled[0]);
  for (let step = 1; step <= index; step++) {
    await user.keyboard('{ArrowDown}');
    await expectActive(menu, enabled[step]);
  }
};

it('keeps distinct-label choices unchanged and dispatches the exact chosen configuration', async () => {
  const first = choice(5, 'Goerli control');
  const second = choice(11155111, 'Sepolia control');
  mockState.vaultGlobal.networks.ethereum = {
    1: active,
    5: first,
    11155111: second,
  };
  const { user, group } = await openMenu();
  expect(group).not.toHaveTextContent('EVM · Chain');
  for (const network of [first, second]) {
    const row = within(group).getByRole('menuitem', {
      name: network.label,
    });
    expect(row).toHaveAccessibleName(network.label);
    expect(row.textContent).toBe(network.label);
  }
  await user.click(
    within(group).getByRole('menuitem', { name: second.label })
  );
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter.mock.calls[0]).toEqual([
    ['wallet', 'setActiveNetwork'],
    [second],
  ]);
  expect(mockEmitter.mock.calls[0][1][0]).toBe(second);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('gives same-label same-glyph choices distinct visible and accessible chain identities without exposing endpoint secrets', async () => {
  const { menu, group } = await openMenu();
  const rows = IDS.map((id) =>
    within(group).getByRole('menuitem', { name: identity(id) })
  );
  const glyphs = rows.map((row) => row.querySelector('svg'));
  expect(glyphs.every(Boolean)).toBe(true);
  expect(glyphs[0]!.outerHTML).toBe(glyphs[1]!.outerHTML);
  for (const [index, row] of rows.entries()) {
    expect(row).toHaveAccessibleName(identity(IDS[index]));
    expect(row).toHaveTextContent(`EVM · Chain ${IDS[index]}`);
    expect(row).toHaveTextContent(SHARED_LABEL);
  }
  for (const secret of [
    'rpc-user',
    'rpc-password',
    'rpc-secret-',
    'explorer-secret-',
    'registry-secret-',
    '.synthetic.invalid/private',
    '?apiKey=',
    '?apikey=',
  ])
    expect(menu.outerHTML).not.toContain(secret);
  expect(mockEmitter).not.toHaveBeenCalled();
});

it.each([
  ['pointer', 5],
  ['pointer', 11155111],
  ['keyboard', 5],
  ['keyboard', 11155111],
] as const)(
  'selects exact same-label chain %s/%s through the actual native menu',
  async (method, chainId) => {
    const expected = mockState.vaultGlobal.networks.ethereum[chainId];
    const { user, menu, group } = await openMenu();
    const target = within(group).getByRole('menuitem', {
      name: identity(chainId),
    });
    if (method === 'keyboard') {
      await reachWithKeys(user, menu, target);
      expect(mockEmitter).not.toHaveBeenCalled();
      await user.keyboard('{Enter}');
    } else await user.click(target);
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'setActiveNetwork'],
      [expected]
    );
    expect(mockEmitter.mock.calls[0][1][0]).toBe(expected);
    expect(screen.queryByRole('menu')).toBeNull();
  }
);

it('cancels by native Escape and returns focus without switching or granting', async () => {
  const { user, menu, group, trigger } = await openMenu();
  const before = JSON.stringify(mockState);
  await reachWithKeys(
    user,
    menu,
    within(group).getByRole('menuitem', {
      name: identity(11155111),
    })
  );
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(mockEmitter).not.toHaveBeenCalled();
  expect(JSON.stringify(mockState)).toBe(before);
});

it('retains the exact current no-op and another same-label choice remains switchable', async () => {
  const current = mockState.vaultGlobal.networks.ethereum[5];
  const other = mockState.vaultGlobal.networks.ethereum[11155111];
  mockState.vault.activeNetwork = current;
  const { user, group, trigger } = await openMenu();
  const currentRow = within(group).getByRole('menuitem', {
    name: identity(5),
  });
  const otherRow = within(group).getByRole('menuitem', {
    name: identity(11155111),
  });
  expect(currentRow).toHaveAttribute('aria-current', 'true');
  expect(otherRow).not.toHaveAttribute('aria-current');
  await user.click(currentRow);
  expect(mockEmitter).not.toHaveBeenCalled();
  // Headless UI dismisses a native choice before the unchanged no-op handler.
  expect(screen.queryByRole('menu')).toBeNull();
  await waitFor(() => expect(trigger).toHaveFocus());
  await user.click(trigger);
  await user.click(
    within(screen.getByRole('group', { name: familyName() })).getByRole(
      'menuitem',
      { name: identity(11155111) }
    )
  );
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter.mock.calls[0][1][0]).toBe(other);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('keeps switching choices disabled and excluded from native keyboard traversal', async () => {
  mockState.vaultGlobal.networkStatus = 'switching';
  const { user, menu, group } = await openMenu();
  const blocked = within(group).getAllByRole('menuitem');
  for (const row of blocked) {
    expect(row).toBeDisabled();
    expect(row).toHaveAttribute('aria-disabled', 'true');
    await user.click(row);
  }
  const blockedIds = blocked.map((row) => row.id);
  await user.keyboard('{Home}');
  for (
    let step = 0;
    step < menu.querySelectorAll('[role="menuitem"]').length;
    step++
  ) {
    expect(blockedIds).not.toContain(
      menu.getAttribute('aria-activedescendant')
    );
    await user.keyboard('{ArrowDown}');
  }
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('removes only unnecessary identity lines after a real registry reducer edit', async () => {
  const { view, group } = await openMenu();
  const selected = mockState.vault.activeNetwork;
  const replacement = choice(11155111, 'Distinct after edit');
  expect(
    within(group).getByRole('menuitem', { name: identity(5) })
  ).toBeTruthy();
  mockState.vaultGlobal = vaultGlobalReducer(
    mockState.vaultGlobal,
    setNetwork({ network: replacement, isEdit: true })
  );
  view.rerender(<NetworkMenu />);
  const updatedGroup = screen.getByRole('group', { name: familyName() });
  expect(
    within(updatedGroup).getByRole('menuitem', {
      name: SHARED_LABEL,
    })
  ).toBeTruthy();
  expect(
    within(updatedGroup).getByRole('menuitem', {
      name: replacement.label,
    })
  ).toBeTruthy();
  expect(updatedGroup).not.toHaveTextContent('EVM · Chain');
  expect(mockState.vault.activeNetwork).toBe(selected);
  expect(mockState.vaultGlobal.networks.ethereum[11155111]).toEqual(
    replacement
  );
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('uses the existing French chain-number catalog in visible and accessible identity', async () => {
  mockLanguage = 'fr';
  const { group } = await openMenu();
  for (const id of IDS) {
    const row = within(group).getByRole('menuitem', {
      name: identity(id),
    });
    expect(row).toHaveAccessibleName(identity(id));
    expect(row).toHaveTextContent(`EVM · Chaîne ${id}`);
    expect(row).not.toHaveTextContent('settings.chainNumber');
  }
});

it('leaves labels repeated only across separate family groups unchanged', async () => {
  mockState.vaultGlobal.networks.ethereum[11155111] = choice(
    11155111,
    'Other EVM'
  );
  mockState.vaultGlobal.networks.syscoin[57].label = SHARED_LABEL;
  const { user, menu, group } = await openMenu();
  expect(
    within(group).getByRole('menuitem', { name: SHARED_LABEL })
  ).toBeTruthy();
  expect(group).not.toHaveTextContent('EVM · Chain');
  await user.click(
    within(menu).getByRole('menuitem', {
      name: familyName(INetworkType.Syscoin),
    })
  );
  const utxoGroup = within(menu).getByRole('group', {
    name: familyName(INetworkType.Syscoin),
  });
  expect(
    within(utxoGroup).getByRole('menuitem', { name: SHARED_LABEL })
  ).toBeTruthy();
  expect(utxoGroup).not.toHaveTextContent('UTXO · Chain');
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('keeps label text literal rather than interpreting it as markup', async () => {
  const label = '<img src=x onerror=synthetic>';
  for (const id of IDS)
    mockState.vaultGlobal.networks.ethereum[id] = choice(id, label);
  const { group } = await openMenu();
  for (const id of IDS) {
    const row = within(group).getByRole('menuitem', {
      name: identity(id, label),
    });
    expect(row).toHaveTextContent(label);
    expect(row.querySelector('img[src="x"]')).toBeNull();
  }
  expect(mockEmitter).not.toHaveBeenCalled();
});
