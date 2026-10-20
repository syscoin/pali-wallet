/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { cleanup, render, waitFor } from '@testing-library/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import en from 'assets/locales/en.json';
import { i18next } from 'utils/i18n';

import { SmartAccountModuleConsent } from './SmartAccountModuleConsent';

let mockQuery: any;
const mockEmitter = jest.fn();
const mockState = {
  dapp: { dapps: {} },
  vaultGlobal: { activeSlip44: 60 },
  vault: {
    activeAccount: { type: 'HDAccount', id: 0 },
    activeNetwork: {
      kind: 'ethereum',
      chainId: 5700,
      url: 'https://rpc.synthetic.invalid',
    },
    accounts: {
      HDAccount: { 0: { id: 0, address: `0x${'11'.repeat(20)}` } },
    },
  },
};
jest.mock('react-redux', () => ({
  useSelector: (select: any) => select(mockState),
}));
jest.mock('hooks/index', () => ({ useQueryData: () => mockQuery }));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    handleWalletLockedError: () => false,
  }),
}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: jest.fn().mockResolvedValue('en'),
    setItem: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('components/index', () => ({
  AddressText: ({ value }: any) => <span>{value}</span>,
  Button: ({ children, disabled, onClick }: any) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Card: ({ children }: any) => <div>{children}</div>,
  Icon: () => null,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <footer>{children}</footer>,
}));
jest.mock('utils/smartAccount', () => ({
  encodeInstallValidatorModuleCall: jest.fn(),
  encodeRotateValidatorModuleCall: jest.fn(),
  encodeUninstallValidatorModuleCall: jest.fn(),
  getSmartAccountLocalOwnerContexts: jest.fn(),
  signAndSubmitSmartAccountExecutions: jest.fn(),
}));

beforeEach(async () => {
  await waitFor(() => expect(i18next.isInitialized).toBe(true));
  await i18next.changeLanguage('en');
  mockEmitter.mockReset().mockImplementation(() => {
    throw new Error('No signing or preflight in text-only control');
  });
});
afterEach(cleanup);

describe.each(['install', 'uninstall'] as const)('%s origin text', (action) => {
  const template =
    action === 'install'
      ? en.smartAccountHub.dappInstallPrompt
      : en.smartAccountHub.dappUninstallPrompt;
  const renderOrigin = (host: string) => {
    mockQuery = {
      host,
      action,
      module: { address: `0x${'22'.repeat(20)}` },
    };
    return render(<SmartAccountModuleConsent />);
  };

  it.each(['http://127.0.0.1:52846', 'https://modules.synthetic.invalid'])(
    'renders the exact URL %s without displaying interpolation entities',
    (host) => {
      const { container } = renderOrigin(host);
      expect(container.querySelector('p.mt-3')?.textContent).toBe(
        template.replace('{{host}}', host)
      );
      expect(i18next.options.interpolation?.escapeValue).toBe(true);
      expect(mockEmitter).not.toHaveBeenCalled();
    }
  );

  it('keeps adversarial markup as literal text without creating elements', () => {
    // Sender-origin normalization does not produce HTML. This is a defensive
    // renderer control, not a claim that a dapp can supply an arbitrary host.
    const host = '<img src=x onerror="window.__originProbe=true"> & "quotes"';
    const { container } = renderOrigin(host);
    expect(container.querySelector('p.mt-3')?.textContent).toBe(
      template.replace('{{host}}', host)
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect((window as any).__originProbe).toBeUndefined();
    expect(i18next.options.interpolation?.escapeValue).toBe(true);
    expect(mockEmitter).not.toHaveBeenCalled();
  });
});

it('keeps the default interpolation escaping outside the call-local override', () => {
  const host = '<img src=x>';
  const DefaultEscaping = () => {
    const { t } = useTranslation();
    return <p>{t('smartAccountHub.dappInstallPrompt', { host })}</p>;
  };
  const { container } = render(<DefaultEscaping />);
  expect(container.textContent).toContain('&lt;img src=x&gt;');
  expect(container.querySelector('img')).toBeNull();
  expect(i18next.options.interpolation?.escapeValue).toBe(true);
});
