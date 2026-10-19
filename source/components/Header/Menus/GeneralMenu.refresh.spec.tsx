/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { GeneralMenu } from './GeneralMenu';

let mockRefreshEnabled = false;
const mockEmitter = jest.fn();

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home', search: '', hash: '' }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vaultGlobal: { advancedSettings: { refresh: mockRefreshEnabled } },
      dapp: { dapps: {} },
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
jest.mock('antd', () => ({ Badge: () => null }));
jest.mock('components/index', () => ({
  Icon: () => <svg aria-hidden="true" />,
  Tooltip: ({ children }: any) => children,
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

const originalChrome = global.chrome;
beforeEach(() => {
  mockRefreshEnabled = true;
  mockEmitter.mockReset().mockResolvedValue(undefined);
  global.chrome = {
    ...originalChrome,
    tabs: { query: jest.fn().mockResolvedValue([]) },
  } as unknown as typeof chrome;
});
afterEach(() => {
  global.chrome = originalChrome;
});

it('keeps the optional refresh control absent until explicitly enabled', () => {
  mockRefreshEnabled = false;
  render(<GeneralMenu />);
  expect(screen.queryByRole('button', { name: 'header.refresh' })).toBeNull();
  expect(mockEmitter).not.toHaveBeenCalled();
});

it('reaches wallet refresh by Tab and activates it with Enter and Space', async () => {
  const user = userEvent.setup();
  render(<GeneralMenu />);
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'settings.connectedSites' })
  );
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'header.refresh' })
  );
  await user.keyboard('{Enter}');
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenLastCalledWith(['refresh'], []);
  await user.keyboard(' ');
  expect(mockEmitter).toHaveBeenCalledTimes(2);
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'generalMenu.generalOptions' })
  );
});

it('retains pointer activation for the same wallet refresh operation', async () => {
  const user = userEvent.setup();
  render(<GeneralMenu />);
  await user.click(screen.getByRole('button', { name: 'header.refresh' }));
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expect(mockEmitter).toHaveBeenLastCalledWith(['refresh'], []);
});
