/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

import en from 'assets/locales/en.json';
import fr from 'assets/locales/fr.json';
import { INetworkType, KeyringAccountType } from 'types/network';

import ConnectedSites from './ConnectedSites';

const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
let mockMessages = en;
let mockHosts: string[];
const mockAccount = {
  id: 0,
  label: 'Synthetic current account',
  address: '0x1111111111111111111111111111111111111111',
  xpub: 'public-synthetic-reference',
};
const mockState = () => ({
  vault: {
    activeAccount: { id: 0, type: KeyringAccountType.HDAccount },
    activeNetwork: { kind: INetworkType.Ethereum, chainId: 1 },
    accounts: { [KeyringAccountType.HDAccount]: { 0: mockAccount } },
  },
  dapp: {
    dapps: Object.fromEntries(
      mockHosts.map((host) => [
        host,
        {
          host,
          accountId: 0,
          accountType: KeyringAccountType.HDAccount,
          chain: INetworkType.Ethereum,
          chainId: 1,
          date: 1,
        },
      ])
    ),
  },
});

jest.mock('react-redux', () => ({
  useSelector: (selector: any) => selector(mockState()),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string | number>) => {
      const resource =
        key === 'settings.connectedSiteCount' && values?.count === 0
          ? `${key}_zero`
          : key;
      const message =
        resource
          .split('.')
          .reduce((entry: any, part) => entry?.[part], mockMessages) || key;
      return message.replace(/{{(\w+)}}/g, (_match: string, name: string) =>
        String(values?.[name] ?? `{{${name}}}`)
      );
    },
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('components/Icon/Icon', () => ({
  EditIconSvg: () => <svg aria-hidden="true" />,
  LoadingSvg: () => <svg aria-hidden="true" />,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
  IconButton: jest.requireActual('components/IconButton/IconButton').IconButton,
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  Icon: () => <svg aria-hidden="true" />,
}));
jest.mock('utils/index', () => ({
  ellipsis: (value: string) => value,
}));

const originalResizeObserver = globalThis.ResizeObserver;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {
      // No layout in JSDOM.
    }
    unobserve() {
      // No layout in JSDOM.
    }
    disconnect() {
      // No layout in JSDOM.
    }
  } as typeof ResizeObserver;
});
afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockMessages = en;
  mockHosts = ['https://first-dapp.invalid', 'https://second-dapp.invalid'];
});
afterEach(() => {
  expect(mockEmitter).not.toHaveBeenCalled();
  cleanup();
});

const mount = () =>
  render(
    <MemoryRouter>
      <ConnectedSites />
    </MemoryRouter>
  );
const row = (host: string) =>
  within(screen.getByText(host, { exact: true }).closest('li')!);

it.each([
  ['English', en],
  ['French', fr],
] as const)(
  'identifies each connection Edit action by its full site in %s',
  (_language, messages) => {
    mockMessages = messages;
    mount();
    for (const host of mockHosts) {
      expect(
        screen.getByRole('button', {
          name: (name) =>
            name === `${messages.settings.editConnection}: ${host}`,
        })
      ).toBeEnabled();
    }
  }
);

it('retains the full site in the action name when the visible row uses truncation', () => {
  const host = `https://${'long-public-subdomain-'.repeat(5)}site.invalid:8443`;
  mockHosts = [host];
  mount();
  expect(screen.getByText(host, { exact: true })).toHaveClass('truncate');
  expect(screen.getByText(host, { exact: true })).toHaveAttribute(
    'title',
    host
  );
  expect(
    screen.getByRole('button', {
      name: (name) => name === `${en.settings.editConnection}: ${host}`,
    })
  ).toBeEnabled();
});

it('healthy pointer review and Close keep the chosen second site and all permissions intact', async () => {
  const user = userEvent.setup();
  mount();
  await user.click(row(mockHosts[1]).getByRole('button'));
  const dialog = screen.getByRole('dialog', {
    name: en.settings.editConnection,
  });
  expect(within(dialog).getByText(mockHosts[1], { exact: true })).toBeVisible();
  expect(within(dialog).queryByText(mockHosts[0], { exact: true })).toBeNull();
  expect(within(dialog).getByText(mockAccount.label)).toBeVisible();
  await user.click(
    within(dialog.querySelector('footer')!).getByRole('button', {
      name: (name) => name === en.buttons.close,
    })
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  for (const host of mockHosts)
    expect(row(host).getByRole('button')).toBeEnabled();
});

it('healthy native Tab and Enter review the second site and Escape cancels without disconnecting', async () => {
  const user = userEvent.setup();
  mount();
  await user.tab();
  expect(row(mockHosts[0]).getByRole('button')).toHaveFocus();
  await user.tab();
  expect(row(mockHosts[1]).getByRole('button')).toHaveFocus();
  await user.keyboard('{Enter}');
  const dialog = screen.getByRole('dialog', {
    name: en.settings.editConnection,
  });
  expect(within(dialog).getByText(mockHosts[1], { exact: true })).toBeVisible();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  for (const host of mockHosts)
    expect(row(host).getByRole('button')).toBeEnabled();
});

it('healthy empty state has no connection action and keeps the page Close control', () => {
  mockHosts = [];
  mount();
  expect(screen.getAllByRole('button')).toHaveLength(1);
  expect(
    screen.getByRole('button', { name: (name) => name === en.buttons.close })
  ).toBeEnabled();
  expect(screen.getByText(en.settings.connectedSiteCount_zero)).toBeVisible();
});
