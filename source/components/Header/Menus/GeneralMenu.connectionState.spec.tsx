/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, render, screen } from '@testing-library/react';
import React from 'react';

import { GeneralMenu } from './GeneralMenu';

let mockDapps: Record<string, any> = {};
const mockEmitter = jest.fn();

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home', search: '', hash: '' }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vaultGlobal: { advancedSettings: { refresh: false } },
      dapp: { dapps: mockDapps },
    }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn() }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('antd', () => ({
  Badge: (props: any) => (
    <span data-testid="badge" className={props.className} />
  ),
}));
jest.mock('components/index', () => ({
  Icon: () => <svg aria-hidden="true" />,
  Tooltip: ({ children, content }: any) => (
    <span data-testid="tab" data-host={content}>
      {children}
    </span>
  ),
  AccountMenu: () => null,
}));
jest.mock('components/Icon/Icon', () => ({
  KeySvg: () => null,
  PaliWhiteSmallIconSvg: () => null,
  TrashIconSvg: () => null,
  LanguageIconSvg: () => null,
  DollarSignIconSvg: () => null,
  HelpIconSvg: () => null,
  LockIconSvg: () => null,
}));

const requests: Array<{
  reject(error: Error): void;
  resolve(value: any): void;
}> = [];
const originalChrome = global.chrome;
beforeEach(() => {
  mockDapps = { 'https://old.example': {} };
  requests.length = 0;
  mockEmitter.mockReset().mockResolvedValue(undefined);
  global.chrome = {
    ...originalChrome,
    tabs: {
      query: jest.fn(
        () =>
          new Promise((resolve, reject) => requests.push({ resolve, reject }))
      ),
    },
  } as unknown as typeof chrome;
});
afterEach(() => {
  global.chrome = originalChrome;
});

const badge = () => screen.getByTestId('badge');
const host = () => screen.getByTestId('tab').getAttribute('data-host');
const reply = async (index: number, value: any) =>
  act(async () => requests[index].resolve(value));

it.each(['newest first', 'oldest first'])(
  'keeps current connection membership and latest tab observation when replies finish %s',
  async (order) => {
    const view = render(<GeneralMenu />);
    mockDapps = {};
    view.rerender(<GeneralMenu />);
    expect(badge()).toHaveClass('bg-warning-error');
    if (order === 'newest first') {
      await reply(1, [{ url: 'https://new.example/current' }]);
      await reply(0, [{ url: 'https://old.example/obsolete' }]);
    } else {
      await reply(0, [{ url: 'https://old.example/obsolete' }]);
      await reply(1, [{ url: 'https://new.example/current' }]);
    }
    expect(host()).toBe('https://new.example');
    expect(badge()).toHaveClass('bg-warning-error');
    expect(requests).toHaveLength(2);
  }
);

it.each([
  { tabs: [] },
  { tabs: [{}] },
  { tabs: [{ url: 'chrome://extensions' }] },
])(
  'clears an unavailable tab URL %j without restoring a disconnected site',
  async ({ tabs }) => {
    const view = render(<GeneralMenu />);
    await reply(0, [{ url: 'https://old.example' }]);
    expect(host()).toBe('https://old.example');
    mockDapps = {};
    view.rerender(<GeneralMenu />);
    await reply(1, tabs);
    expect(host()).toBe('');
    expect(badge()).toHaveClass('bg-warning-error');
  }
);

it('keeps a remaining current connection green and clears a failed current tab read', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation();
  try {
    const view = render(<GeneralMenu />);
    await reply(0, [{ url: 'https://old.example' }]);
    mockDapps = { 'https://remaining.example': {} };
    view.rerender(<GeneralMenu />);
    await act(async () => requests[1].reject(new Error('Tab unavailable')));
    expect(host()).toBe('');
    expect(badge()).toHaveClass('bg-warning-success');
  } finally {
    log.mockRestore();
  }
});
