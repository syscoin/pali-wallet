import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Start } from './Start';

let mockSearchParams: URLSearchParams;
let mockUnlockProps: any;
jest.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams],
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({ vaultGlobal: { hasEncryptedVault: true } }),
}));
jest.mock('state/vault/selectors', () => ({
  selectActiveAccount: () => ({ address: 'test address' }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/Modal/WarningBaseModal', () => ({
  ImportWalletWarning: () => null,
}));
jest.mock('components/Start/GetStarted', () => () => null);
jest.mock('components/Start/Unlock', () => (props: any) => {
  mockUnlockProps = props;
  return null;
});
jest.mock('hooks/useAppReady', () => ({ useAppReady: jest.fn() }));

it.each([
  'Sign #exact & literal + % data?',
  'Unicode: café 🛡',
  'ordinary message',
])('preserves approval data through the locked-wallet route: %s', (message) => {
  const data = JSON.stringify({
    message,
    host: 'https://dapp.test',
    approvalId: 'nonce',
  });
  mockSearchParams = new URLSearchParams({ externalRoute: 'tx/ethSign', data });
  renderToStaticMarkup(<Start />);
  const destination = new URL(
    mockUnlockProps.externalRoute,
    'chrome-extension://pali'
  );
  expect(destination.pathname).toBe('/external/tx/ethSign');
  expect(destination.hash).toBe('');
  expect(destination.searchParams.get('data')).toBe(data);
});
