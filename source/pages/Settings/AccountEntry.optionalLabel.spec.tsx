/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import CreateAccount from './CreateAccount';
import ImportAccount from './ImportAccount';

const mockEmitter = jest.fn();
const mockNavigate = jest.fn();
let mockSmartOnly = false;
const PUBLIC_ADDRESS = '0x0000000000000000000000000000000000000042';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('react-redux', () => ({
  useSelector: (select: any) =>
    select({
      vault: {
        accounts: { HDAccount: { 0: { id: 0, address: PUBLIC_ADDRESS } } },
        activeAccount: { id: 0, type: 'HDAccount' },
        isBitcoinBased: false,
        activeNetwork: {
          kind: 'ethereum',
          chainId: 1,
          url: 'https://fixture.invalid',
        },
      },
    }),
}));
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({
    pathname: '/settings/account/new',
    state: { smartAccountOnly: mockSmartOnly },
  }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: mockNavigate, alert: { error: jest.fn() } }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({
    controllerEmitter: mockEmitter,
    handleWalletLockedError: () => false,
  }),
}));
jest.mock('hooks/usePageLoadingState', () => ({
  usePageLoadingState: () => ({ isContextChanging: false }),
}));
jest.mock('antd/es/form/Form', () => ({
  useForm: jest.requireActual('antd').Form.useForm,
}));
jest.mock('utils/index', () => ({
  extractErrorMessage: (_error: unknown, fallback: string) => fallback,
}));
jest.mock('utils/navigationState', () => ({ navigateBack: jest.fn() }));
jest.mock('utils/validatePrivateKey', () => ({
  validatePrivateKeyValue: jest.fn(async () => true),
}));
jest.mock('components/index', () => ({
  Icon: () => null,
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  Button: jest.requireActual('components/Button/Button').Button,
}));
jest.mock('components/Icon/Icon', () => ({
  LoadingSvg: () => <svg aria-hidden="true" />,
}));
jest.mock('components/Modal/WarningBaseModal', () => ({
  CreatedAccountSuccessfully: ({ show }: any) =>
    show ? <div role="status">Created</div> : null,
  ImportedWalletSuccessfully: ({ show }: any) =>
    show ? <div role="status">Imported</div> : null,
}));

const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
});
afterAll(() => {
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});
beforeEach(() => {
  jest.clearAllMocks();
  mockSmartOnly = false;
  // The real AntD form and Pali submit button run. Only terminal dispatch and
  // identifier validation are synthetic; no keys, account creation or storage.
  mockEmitter.mockImplementation(async (methods: string[], args: unknown[]) =>
    methods[1] === 'validateWatchOnlyIdentifier'
      ? args[0] === PUBLIC_ADDRESS
      : { id: 1, address: PUBLIC_ADDRESS }
  );
});

describe.each(['ordinary', 'smart', 'private import', 'watch import'])(
  '%s optional account label',
  (mode) => {
    it.each([
      ['omitted', undefined, undefined],
      ['ordinary spaces', '   ', undefined],
      ['non-breaking spaces', '\u00a0\u00a0', undefined],
      ['meaningful padding', '  Family savings  ', '  Family savings  '],
    ])(
      'handles %s without changing meaningful spelling',
      async (_name, value, expected) => {
        const importing = mode.endsWith('import');
        mockSmartOnly = mode === 'smart';
        render(importing ? <ImportAccount /> : <CreateAccount />);
        const label = screen.getByRole('textbox', {
          name: importing
            ? 'settings.label (settings.optional)'
            : 'settings.nameYourNewAccount (settings.optional)',
        });
        if (value !== undefined) fireEvent.change(label, { target: { value } });

        if (importing) {
          if (mode === 'watch import')
            fireEvent.click(
              screen.getByRole('checkbox', { name: 'settings.watchOnly' })
            );
          fireEvent.change(
            screen.getByLabelText(
              mode === 'watch import'
                ? 'settings.publicIdentifierInput'
                : 'settings.yourPrivateKey'
            ),
            {
              target: {
                value:
                  mode === 'watch import'
                    ? PUBLIC_ADDRESS
                    : 'synthetic-private-input',
              },
            }
          );
        }

        const submit = screen.getByRole('button', {
          name: importing
            ? 'buttons.import'
            : mockSmartOnly
            ? 'settings.createSmartAccount'
            : 'buttons.create',
        });
        await waitFor(() => expect(submit).toBeEnabled());
        fireEvent.click(submit);
        const method = importing
          ? mode === 'watch import'
            ? 'importWatchOnlyFromController'
            : 'importAccountFromPrivateKey'
          : mockSmartOnly
          ? 'createSmartAccount'
          : 'createAccount';
        await waitFor(() =>
          expect(mockEmitter).toHaveBeenCalledWith(
            ['wallet', method],
            expect.any(Array),
            ...(mockSmartOnly ? [300000] : [])
          )
        );
        const calls = mockEmitter.mock.calls.filter(
          ([methods]) => methods[1] === method
        );
        expect(calls).toHaveLength(1);
        const args = calls[0][1];
        if (mockSmartOnly) expect(args).toEqual([{ label: expected }]);
        else if (importing)
          expect(args).toEqual([
            mode === 'watch import'
              ? PUBLIC_ADDRESS
              : 'synthetic-private-input',
            expected,
            ...(mode === 'private import' ? [undefined] : []),
          ]);
        else expect(args).toEqual([expected]);
        expect(mockNavigate).not.toHaveBeenCalled();
      }
    );
  }
);
