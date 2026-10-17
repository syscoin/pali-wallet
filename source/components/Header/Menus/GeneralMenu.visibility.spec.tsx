/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { GeneralMenu } from './GeneralMenu';

jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/home', search: '', hash: '' }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({ vaultGlobal: { advancedSettings: {} }, dapp: { dapps: {} } }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('hooks/index', () => ({ useUtils: () => ({ navigate: jest.fn() }) }));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: jest.fn() }),
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
  global.chrome = {
    ...originalChrome,
    tabs: { query: jest.fn().mockResolvedValue([]) },
  } as unknown as typeof chrome;
});
afterEach(() => {
  global.chrome = originalChrome;
});

it('removes the closed menu from accessibility and sequential keyboard navigation', async () => {
  const user = userEvent.setup();
  render(
    <>
      <GeneralMenu />
      <button>After header</button>
    </>
  );
  expect(screen.queryByRole('menu')).toBeNull();
  await user.tab();
  const trigger = screen.getByRole('button', {
    name: 'generalMenu.generalOptions',
  });
  expect(document.activeElement).toBe(trigger);
  await user.tab();
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'After header' })
  );
  await user.click(trigger);
  expect(screen.getByRole('menu')).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
});
