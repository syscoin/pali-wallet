/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Mnemonic } from 'ethers';
import React from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';

import {
  OnboardingSecretsProvider,
  useOnboardingSecrets,
} from 'hooks/useOnboardingSecrets';

import ImportPhrase from './ImportPhrase';

// Disposable deterministic entropy, validated locally. Never create a wallet
// or contact a network, and never put the resulting phrase into diagnostics.
let phrase: string;
const RECOVERY_TICKET = 'synthetic-keyboard-recovery-ticket';
const mockEmitter = jest.fn();
const originalMessageChannel = globalThis.MessageChannel;
const originalResizeObserver = globalThis.ResizeObserver;
const originalUint8Array = globalThis.Uint8Array;

jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
}));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <svg /> }));
jest.mock('components/Layout/OnboardingLayout', () => ({
  OnboardingLayout: ({ children }: any) => <section>{children}</section>,
}));
jest.mock('components/Modal/StatusModal', () => ({ StatusModal: () => null }));

const Probe = () => {
  const { secrets, beginRecovery } = useOnboardingSecrets();
  return (
    <>
      <output data-testid="route">{useLocation().pathname}</output>
      <output data-testid="draft">
        {secrets.phrase === phrase ? 'synthetic phrase retained' : 'none'}
      </output>
      <output data-testid="recovery-ticket">
        {secrets.recoveryTicket === RECOVERY_TICKET ? 'present' : 'absent'}
      </output>
      <button type="button" onClick={() => beginRecovery(RECOVERY_TICKET)}>
        Begin synthetic recovery
      </button>
    </>
  );
};

const mount = () =>
  render(
    <BrowserRouter>
      <OnboardingSecretsProvider>
        <Routes>
          <Route path="/import" element={<ImportPhrase />} />
          <Route
            path="/create-password-import"
            element={<p>Password step</p>}
          />
          <Route path="/" element={<p>Start page</p>} />
        </Routes>
        <Probe />
      </OnboardingSecretsProvider>
    </BrowserRouter>
  );

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/import');
  window.matchMedia = jest.fn(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  })) as any;
  globalThis.Uint8Array = Object.getPrototypeOf(Buffer.prototype).constructor;
  phrase = Mnemonic.fromEntropy('0x4748494a4b4c4d4e4f50515253545556').phrase;
  globalThis.MessageChannel = class {
    port1 = { onmessage: null as (() => void) | null };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as any;
  globalThis.ResizeObserver = class {
    observe() {
      return undefined;
    }
    unobserve() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  } as any;
  mockEmitter.mockImplementation(async (path: string[], [phrase]: string[]) => {
    expect(path).toEqual(['wallet', 'isSeedValid']);
    return Mnemonic.isValidMnemonic(phrase);
  });
  expect(Mnemonic.isValidMnemonic(phrase)).toBe(true);
});

afterEach(() => {
  // This screen may validate only: no wallet creation, recovery or persistence.
  for (const [path] of mockEmitter.mock.calls) {
    expect(path).toEqual(['wallet', 'isSeedValid']);
  }
  cleanup();
  globalThis.MessageChannel = originalMessageChannel;
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.Uint8Array = originalUint8Array;
});

describe.each([false, true])(
  'seed import keyboard submission (recovery=%s)',
  (recovery) => {
    it.each(['pointer', 'button Enter', 'textarea Enter'] as const)(
      'advances a valid unchanged phrase using %s',
      async (activation) => {
        const user = userEvent.setup();
        mount();
        if (recovery) {
          await user.click(
            screen.getByRole('button', { name: 'Begin synthetic recovery' })
          );
        }
        const textarea = screen.getByRole('textbox', {
          name: 'import.pasteYourWalletSeed',
        });
        const submit = screen.getByRole('button', {
          name: recovery ? 'buttons.recoverWallet' : 'buttons.import',
        });
        expect(textarea.tagName).toBe('TEXTAREA');
        expect(submit).toBeDisabled();
        await user.click(textarea);
        await user.paste(phrase);
        await waitFor(() => expect(submit).toBeEnabled());
        expect(textarea).toHaveFocus();

        if (activation === 'pointer') {
          await user.click(submit);
        } else if (activation === 'button Enter') {
          await user.tab();
          expect(
            screen.getByRole('button', { name: 'import.hideSeedPhrase' })
          ).toHaveFocus();
          await user.tab();
          expect(submit).toHaveFocus();
          await user.keyboard('{Enter}');
        } else {
          // Exercise actual keydown/keypress/default textarea input/keyup rather
          // than dispatching submit or directly invoking the component handler.
          await user.keyboard('{Enter}');
        }

        await waitFor(
          () => expect(screen.queryByText('Password step')).not.toBeNull(),
          {
            onTimeout: () =>
              new Error(
                `Valid phrase did not reach password step using ${activation}; ` +
                  `route=${screen.getByTestId('route').textContent}`
              ),
          }
        );
        expect(screen.getByTestId('route')).toHaveTextContent(
          '/create-password-import'
        );
        expect(screen.getByTestId('draft')).toHaveTextContent(
          'synthetic phrase retained'
        );
        expect(screen.getByTestId('recovery-ticket')).toHaveTextContent(
          recovery ? 'present' : 'absent'
        );
      }
    );
  }
);
