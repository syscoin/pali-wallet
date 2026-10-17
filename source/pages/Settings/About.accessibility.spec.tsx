/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import About from './About';

const mockCopy = jest.fn();
const mockAlert = { info: jest.fn(), error: jest.fn() };
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/settings/about' }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({
    navigate: jest.fn(),
    useCopyClipboard: () => [false, mockCopy],
    alert: mockAlert,
  }),
}));
jest.mock('utils/navigationState', () => ({ navigateBack: jest.fn() }));
jest.mock('components/Icon/Icon', () => ({
  PaliWhiteSmallIconSvg: () => <svg />,
}));
jest.mock('components/index', () => ({
  Icon: () => <span aria-hidden="true" />,
  SimpleCard: ({ children }: any) => <div>{children}</div>,
  PageActionFooter: ({ children }: any) => <div>{children}</div>,
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  IconButton: ({ children, onClick, 'aria-label': label, className }: any) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={className}
    >
      {children}
    </button>
  ),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

it('exposes real support links and a separately named copy control', () => {
  render(<About />);
  const links = screen
    .getAllByRole('link')
    .filter(
      (link) =>
        link.getAttribute('href') === 'https://discord.com/invite/syscoin'
    );
  expect(links).toHaveLength(2);
  links.forEach((link) => {
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
  expect(
    screen.getByRole('button', { name: 'buttons.copy settings.userSupport' })
  ).toBeTruthy();
});

it('reports clipboard denial without claiming the support URL was copied', async () => {
  mockCopy.mockRejectedValueOnce(new Error('Synthetic clipboard denial'));
  render(<About />);
  fireEvent.click(
    screen.getByRole('button', { name: 'buttons.copy settings.userSupport' })
  );
  await waitFor(() =>
    expect(mockAlert.error).toHaveBeenCalledWith('transactions.copyFailed')
  );
  expect(mockAlert.info).not.toHaveBeenCalled();
});
