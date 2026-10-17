/** @jest-environment jsdom */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { INetworkType } from 'types/network';

import { NetworkMenu } from './NetworkMenu';

const mockEmitter = jest.fn();
const mockDispatch = jest.fn();
const mockNetworks = {
  syscoin: {
    mainnet: {
      chainId: 57,
      kind: INetworkType.Syscoin,
      url: 'https://syscoin-main.example',
      label: 'Syscoin Mainnet',
    },
    testnet: {
      chainId: 5700,
      kind: INetworkType.Syscoin,
      url: 'https://syscoin-test.example',
      label: 'Syscoin Testnet',
    },
  },
  ethereum: {
    mainnet: {
      chainId: 1,
      kind: INetworkType.Ethereum,
      url: 'https://ethereum-main.example',
      label: 'Ethereum Mainnet',
    },
    testnet: {
      chainId: 11155111,
      kind: INetworkType.Ethereum,
      url: 'https://ethereum-test.example',
      label: 'Ethereum Sepolia',
    },
  },
};
const mockState = {
  vault: {
    activeNetwork: mockNetworks.syscoin.mainnet,
    isBitcoinBased: true,
  },
  vaultGlobal: {
    advancedSettings: { refresh: false },
    networkStatus: 'idle',
    networks: mockNetworks,
  },
  dapp: { dapps: {} },
};
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home', search: '', hash: '', state: {} }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'networkMenu.noConnected': 'Connected sites',
        'networkMenu.trustedSites': 'Trusted sites',
        'networkMenu.utxoNetworks': 'UTXO networks',
        'networkMenu.evmNetworks': 'EVM networks',
      }[key] || key),
    i18n: { language: 'en' },
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn() }),
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
jest.mock('components/ChainIcon', () => ({ ChainIcon: () => null }));
jest.mock('components/Icon/Icon', () => ({
  DropdownArrowSvg: () => null,
  BtcIconSvg: () => null,
  EthIconSvg: () => null,
  WhiteSuccessIconSvg: () => null,
  NetworkIconSvg: () => null,
  EditIconSvg: () => null,
  LoadingSvg: () => <svg data-testid="network-loading" />,
}));
jest.mock('components/index', () => ({
  Icon: ({ name }: { name: string }) => <svg data-testid={`icon-${name}`} />,
}));
jest.mock('components/Spinner/Spinner', () => ({
  __esModule: true,
  default: () => <span data-testid="header-loading" />,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockEmitter.mockResolvedValue(undefined);
  mockState.vault.activeNetwork = mockNetworks.syscoin.mainnet;
  mockState.vault.isBitcoinBased = true;
  mockState.vaultGlobal.networkStatus = 'idle';
});

const openMenu = async () => {
  const user = userEvent.setup();
  const view = render(<NetworkMenu />);
  const trigger = screen.getByRole('button', { name: /Syscoin Mainnet/ });
  await user.click(trigger);
  const menu = screen.getByRole('menu');
  return { ...view, user, trigger, menu };
};

const expectActive = async (menu: HTMLElement, item: HTMLElement) => {
  await waitFor(() =>
    expect(menu.getAttribute('aria-activedescendant')).toBe(item.id)
  );
  expect(document.activeElement).toBe(menu);
};

it('opens from the keyboard and reaches the family toggles in the menu order', async () => {
  const user = userEvent.setup();
  render(<NetworkMenu />);
  const trigger = screen.getByRole('button', { name: /Syscoin Mainnet/ });
  await user.tab();
  expect(document.activeElement).toBe(trigger);
  await user.keyboard('{Enter}');
  const menu = screen.getByRole('menu');
  // Headless UI assigns the initial item after opening has focused the menu.
  await expectActive(
    menu,
    screen.getByRole('menuitem', { name: 'Connected sites' })
  );
  await user.keyboard('{ArrowDown}{ArrowDown}');
  const group = screen.getByRole('menuitem', { name: 'UTXO networks' });
  await expectActive(menu, group);
  await user.keyboard('{Enter}');
  expect(group.getAttribute('aria-expanded')).toBe('true');
  await expectActive(menu, group);
  expect(mockEmitter).not.toHaveBeenCalled();
});

it.each([
  ['UTXO networks', 2, mockNetworks.syscoin.testnet],
  ['EVM networks', 3, mockNetworks.ethereum.testnet],
])(
  'opens %s and activates an individual choice with arrows and Enter',
  async (family, groupSteps, chosen) => {
    const { user, menu } = await openMenu();
    const group = screen.getByRole('menuitem', { name: family });
    expect(group.tagName).toBe('BUTTON');
    expect(group.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menuitem', { name: chosen.label })).toBeNull();

    await user.keyboard(`{Home}${'{ArrowDown}'.repeat(groupSteps)}`);
    await expectActive(menu, group);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu')).toBe(menu);
    expect(group.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('group', { name: family }).id).toBe(
      group.getAttribute('aria-controls')
    );
    await expectActive(menu, group);

    await user.keyboard('{ArrowDown}{ArrowDown}');
    const choice = screen.getByRole('menuitem', { name: chosen.label });
    await expectActive(menu, choice);
    expect(choice.tagName).toBe('BUTTON');
    await user.keyboard('{Enter}');
    expect(mockEmitter).toHaveBeenCalledTimes(1);
    expect(mockEmitter).toHaveBeenCalledWith(
      ['wallet', 'setActiveNetwork'],
      [chosen]
    );
    expect(screen.queryByRole('menu')).toBeNull();
  }
);

it('keeps a group focused when Space or pointer activation toggles it and excludes collapsed choices', async () => {
  const { user, menu } = await openMenu();
  const group = screen.getByRole('menuitem', { name: 'UTXO networks' });
  await user.keyboard('{Home}{ArrowDown}{ArrowDown}');
  await expectActive(menu, group);
  await user.keyboard(' ');
  await expectActive(menu, group);
  expect(group.getAttribute('aria-expanded')).toBe('true');
  expect(
    screen.getByRole('menuitem', { name: 'Syscoin Testnet' })
  ).toBeTruthy();

  await user.keyboard(' ');
  await expectActive(menu, group);
  expect(group.getAttribute('aria-expanded')).toBe('false');
  expect(
    screen.queryByRole('menuitem', { name: 'Syscoin Testnet' })
  ).toBeNull();
  await user.keyboard('{ArrowDown}');
  await expectActive(
    menu,
    screen.getByRole('menuitem', { name: 'EVM networks' })
  );

  await user.click(group);
  expect(screen.getByRole('menu')).toBe(menu);
  expect(group.getAttribute('aria-expanded')).toBe('true');
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('preserves choice typeahead and restores trigger focus after Escape without switching', async () => {
  const { user, menu, trigger } = await openMenu();
  await user.click(screen.getByRole('menuitem', { name: 'UTXO networks' }));
  await user.click(screen.getByRole('menuitem', { name: 'EVM networks' }));
  expect(screen.getByRole('group', { name: 'EVM networks' })).toBeTruthy();
  await user.keyboard('Ethereum');
  await expectActive(
    menu,
    screen.getByRole('menuitem', { name: 'Ethereum Mainnet' })
  );
  await user.keyboard(' S');
  await expectActive(
    menu,
    screen.getByRole('menuitem', { name: 'Ethereum Sepolia' })
  );
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(mockEmitter).not.toHaveBeenCalled();
});

it.each([
  ['UTXO networks', 'UTXO', mockNetworks.syscoin.testnet],
  ['EVM networks', 'EVM', mockNetworks.ethereum.testnet],
])(
  'keeps the space in a %s-prefixed custom network typeahead query',
  async (family, prefix, network) => {
    const originalLabel = network.label;
    network.label = `${prefix} Custom`;
    try {
      const { user, menu } = await openMenu();
      const group = screen.getByRole('menuitem', { name: family });
      await user.click(group);
      await user.keyboard(`{Home}${prefix}`);
      await expectActive(menu, group);
      await user.keyboard(' C');
      expect(group.getAttribute('aria-expanded')).toBe('true');
      await expectActive(
        menu,
        screen.getByRole('menuitem', { name: network.label })
      );
      expect(mockEmitter).not.toHaveBeenCalled();
      await user.keyboard('{Enter}');
      expect(mockEmitter).toHaveBeenCalledTimes(1);
      expect(mockEmitter).toHaveBeenCalledWith(
        ['wallet', 'setActiveNetwork'],
        [network]
      );
    } finally {
      network.label = originalLabel;
    }
  }
);

it('starts a fresh choice query after activating a typeahead-selected group with Enter', async () => {
  const { user, menu } = await openMenu();
  await user.keyboard('{Home}UTXO');
  const group = screen.getByRole('menuitem', { name: 'UTXO networks' });
  await expectActive(menu, group);
  await user.keyboard('{Enter}');
  expect(group.getAttribute('aria-expanded')).toBe('true');
  await user.keyboard('Syscoin T');
  await expectActive(
    menu,
    screen.getByRole('menuitem', { name: 'Syscoin Testnet' })
  );
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('treats Space as group activation after the native typeahead timeout', async () => {
  const { user, menu } = await openMenu();
  await user.keyboard('{Home}UTXO');
  const group = screen.getByRole('menuitem', { name: 'UTXO networks' });
  await expectActive(menu, group);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  await user.keyboard(' ');
  expect(group.getAttribute('aria-expanded')).toBe('true');
  await expectActive(menu, group);
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('keeps the native query active when paused after a typeahead Space', async () => {
  const { user, menu } = await openMenu();
  const group = screen.getByRole('menuitem', { name: 'UTXO networks' });
  await user.click(group);
  await user.keyboard('{Home}UTXO ');
  await expectActive(menu, group);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  await user.keyboard(' ');
  expect(screen.getByRole('menu')).toBe(menu);
  expect(group.getAttribute('aria-expanded')).toBe('true');
  await expectActive(menu, group);
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('clears the query when pointer movement makes a group the active item', async () => {
  const { user, menu } = await openMenu();
  const group = screen.getByRole('menuitem', { name: 'UTXO networks' });
  await user.click(group);
  await user.keyboard('{Home}Syscoin T');
  await expectActive(
    menu,
    screen.getByRole('menuitem', { name: 'Syscoin Testnet' })
  );
  fireEvent.mouseEnter(group, { screenX: 10, screenY: 10 });
  fireEvent.mouseMove(group, { screenX: 11, screenY: 10 });
  await expectActive(menu, group);
  await user.keyboard(' ');
  expect(screen.getByRole('menu')).toBe(menu);
  expect(group.getAttribute('aria-expanded')).toBe('false');
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('does not clear typeahead for a stationary pointer on the active group', async () => {
  const { user, menu } = await openMenu();
  const group = screen.getByRole('menuitem', { name: 'UTXO networks' });
  await user.click(group);
  await user.keyboard('{Home}UTXO');
  await expectActive(menu, group);
  fireEvent.mouseEnter(group, { screenX: 10, screenY: 10 });
  fireEvent.mouseMove(group, { screenX: 10, screenY: 10 });
  await user.keyboard(' ');
  expect(screen.getByRole('menu')).toBe(menu);
  expect(group.getAttribute('aria-expanded')).toBe('true');
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('clears typeahead for navigation keys before activating a group with Space', async () => {
  const { user, menu } = await openMenu();
  await user.keyboard('{Home}UTXO{End}{Home}{ArrowDown}{ArrowDown}');
  const group = screen.getByRole('menuitem', { name: 'UTXO networks' });
  await expectActive(menu, group);
  await user.keyboard(' ');
  expect(group.getAttribute('aria-expanded')).toBe('true');
  await expectActive(menu, group);
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('uses the normal pointer selection for individual network choices', async () => {
  const { user } = await openMenu();
  await user.click(screen.getByRole('menuitem', { name: 'UTXO networks' }));
  await user.click(screen.getByRole('menuitem', { name: 'Syscoin Testnet' }));
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'setActiveNetwork'],
    [mockNetworks.syscoin.testnet]
  );
  expect(screen.queryByRole('menu')).toBeNull();
});

it('disables all choices while switching, keeps the current spinner, and skips disabled rows for keyboard navigation', async () => {
  const { user, menu, rerender } = await openMenu();
  const group = screen.getByRole('menuitem', { name: 'UTXO networks' });
  await user.click(group);
  await user.click(screen.getByRole('menuitem', { name: 'EVM networks' }));
  mockState.vaultGlobal.networkStatus = 'switching';
  rerender(<NetworkMenu />);
  const current = screen.getByRole('menuitem', { name: 'Syscoin Mainnet' });
  const choice = screen.getByRole('menuitem', { name: 'Syscoin Testnet' });
  expect(current.getAttribute('aria-current')).toBe('true');
  expect(within(current).getByTestId('network-loading')).toBeTruthy();
  expect(screen.getByTestId('header-loading')).toBeTruthy();
  for (const name of [
    'Syscoin Mainnet',
    'Syscoin Testnet',
    'Ethereum Mainnet',
    'Ethereum Sepolia',
  ]) {
    const row = screen.getByRole('menuitem', { name }) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(row.getAttribute('aria-disabled')).toBe('true');
  }
  fireEvent.click(choice);
  await user.keyboard('{Home}{ArrowDown}{ArrowDown}{ArrowDown}');
  await expectActive(
    menu,
    screen.getByRole('menuitem', { name: 'EVM networks' })
  );
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('does not start another switch when choosing the current network', async () => {
  const { user } = await openMenu();
  await user.click(screen.getByRole('menuitem', { name: 'UTXO networks' }));
  await user.click(screen.getByRole('menuitem', { name: 'Syscoin Mainnet' }));
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('does not activate a previously highlighted row after switching starts', async () => {
  const { user, menu, rerender } = await openMenu();
  await user.click(screen.getByRole('menuitem', { name: 'UTXO networks' }));
  await user.keyboard('{ArrowDown}{ArrowDown}');
  await expectActive(
    menu,
    screen.getByRole('menuitem', { name: 'Syscoin Testnet' })
  );
  mockState.vaultGlobal.networkStatus = 'switching';
  rerender(<NetworkMenu />);
  await user.keyboard('{Enter}');
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('does not expose a menu while the header action is disabled', async () => {
  const user = userEvent.setup();
  render(<NetworkMenu disabled />);
  const trigger = screen.getByRole('button', {
    name: /Syscoin Mainnet/,
  }) as HTMLButtonElement;
  expect(trigger.disabled).toBe(true);
  await user.click(trigger);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});
