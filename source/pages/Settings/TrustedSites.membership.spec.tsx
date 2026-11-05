/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { MAX_DAPP_SITE_LOOKUP_LENGTH } from 'utils/dappOrigin';

import TrustedSites from './TrustedSites';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({
    pathname: '/settings/networks/trusted-sites',
    state: {},
  }),
}));
jest.mock('hooks/index', () => ({ useUtils: () => ({ navigate: jest.fn() }) }));
jest.mock('components/index', () => ({ Icon: () => null }));
jest.mock('utils/index', () => ({ truncate: (value: string) => value }));
jest.mock('constants/trustedApps.json', () => [
  'bridge.syscoin.org',
  'metamask.io',
]);
jest.mock('antd', () => ({
  Input: ({ suffix, ...props }: any) => (
    <>
      <input {...props} />
      {suffix}
    </>
  ),
}));

it.each([
  'bridge',
  'bridge.syscoin.org.attacker.test',
  'http://bridge.syscoin.org',
  'https://bridge.syscoin.org:8443',
  'https://attacker.test/bridge.syscoin.org',
  'mailto:user@bridge.syscoin.org',
])(
  'does not label a prefix, lookalike or nontrusted origin as trusted: %s',
  (query) => {
    render(<TrustedSites />);
    fireEvent.change(
      screen.getByRole('textbox', { name: 'settings.searchTrustedSites' }),
      { target: { value: query } }
    );
    expect(screen.queryByText('settings.trustedSiteMatch')).toBeNull();
    expect(screen.getByText('settings.unlistedSite')).toBeTruthy();
  }
);

it.each([
  'bridge.syscoin.org',
  'https://BRIDGE.SYSCOIN.ORG/path',
  'https://bridge.syscoin.org:443',
])(
  'matches exact trusted HTTPS host using the existing origin rules: %s',
  (query) => {
    render(<TrustedSites />);
    fireEvent.change(
      screen.getByRole('textbox', { name: 'settings.searchTrustedSites' }),
      { target: { value: query } }
    );
    expect(screen.getByText('settings.trustedSiteMatch')).toBeTruthy();
    expect(screen.getByText('bridge.syscoin.org')).toBeTruthy();
  }
);

it('keeps partial search results without granting a trusted badge', () => {
  render(<TrustedSites />);
  fireEvent.change(
    screen.getByRole('textbox', { name: 'settings.searchTrustedSites' }),
    { target: { value: 'bridge' } }
  );
  expect(screen.getByText('bridge.syscoin.org')).toBeTruthy();
  expect(screen.queryByText('metamask.io')).toBeNull();
});

it('reads a full Unicode paste before capping the displayed text', () => {
  render(<TrustedSites />);
  const input = screen.getByRole<HTMLInputElement>('textbox', {
    name: 'settings.searchTrustedSites',
  });
  expect(input.hasAttribute('maxlength')).toBe(false);
  const prefix = 'https://bridge.syscoin.org'.padEnd(
    MAX_DAPP_SITE_LOOKUP_LENGTH
  );
  fireEvent.change(input, { target: { value: `${prefix}😈@attacker.test` } });
  expect(input.value).toBe(`${prefix}…`);
  expect(screen.queryByText('settings.trustedSiteMatch')).toBeNull();
  expect(screen.queryByText('bridge.syscoin.org')).toBeNull();
  expect(screen.getByText('settings.unlistedSite')).toBeTruthy();
});
