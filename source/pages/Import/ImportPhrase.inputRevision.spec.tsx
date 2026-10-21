/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Mnemonic } from 'ethers';
import React from 'react';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';

import {
  OnboardingSecretsProvider,
  useOnboardingSecrets,
} from 'hooks/useOnboardingSecrets';

import ImportPhrase from './ImportPhrase';

// Public BIP39 fixtures; these tests never create or persist a wallet.
const PHRASE_A =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PHRASE_B =
  'legal winner thank year wave sausage worth useful legal winner thank yellow';
const RECOVERY_TICKET = 'synthetic-recovery-ticket';
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
  Button: ({ children, loading, ...props }: any) => (
    <button {...props} aria-busy={loading}>
      {children}
    </button>
  ),
}));
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
        {secrets.phrase === PHRASE_A
          ? 'A'
          : secrets.phrase === PHRASE_B
          ? 'B'
          : 'none'}
      </output>
      <output data-testid="recovery-ticket">
        {secrets.recoveryTicket === RECOVERY_TICKET ? 'present' : 'absent'}
      </output>
      <button onClick={() => beginRecovery(RECOVERY_TICKET)}>
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

const importButton = () =>
  screen.getByRole('button', {
    name: /^(buttons.import|buttons.recoverWallet)$/,
  });

const enterPhrase = async (
  user: ReturnType<typeof userEvent.setup>,
  phrase: string
) => {
  const textbox = screen.getByRole('textbox');
  await user.clear(textbox);
  if (phrase) await user.paste(phrase);
  expect(textbox).toHaveValue(phrase);
  if (phrase) await waitFor(() => expect(importButton()).toBeEnabled());
};

// Arm after input validation: the next check belongs to Ant Form's submit
// validation and the second belongs to ImportPhrase's final controller check.
const holdFinalCheck = (phrase: string) => {
  let resolve!: (valid: boolean) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<boolean>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const gate = { held: false, calls: 0, resolve, reject };
  const previous = mockEmitter.getMockImplementation()!;
  mockEmitter.mockImplementation((path: string[], args: string[]) => {
    if (args[0] === phrase) {
      gate.calls += 1;
      if (gate.calls === 2) {
        gate.held = true;
        return promise;
      }
    }
    return previous(path, args);
  });
  return gate;
};

const expectDraft = (route: string, draft: string) => {
  expect(screen.getByTestId('route')).toHaveTextContent(route);
  expect(screen.getByTestId('draft')).toHaveTextContent(draft);
};

beforeEach(() => {
  jest.clearAllMocks();
  window.history.replaceState(null, '', '/import');
  window.matchMedia = jest.fn(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  })) as any;
  // Node's ethers SHA256 returns a Buffer; align jsdom's byte-array realm.
  globalThis.Uint8Array = Object.getPrototypeOf(Buffer.prototype).constructor;
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
});

afterEach(() => {
  // The real form must never reach a create, recover, or persistence operation.
  for (const [path] of mockEmitter.mock.calls) {
    expect(path).toEqual(['wallet', 'isSeedValid']);
  }
  cleanup();
  globalThis.MessageChannel = originalMessageChannel;
  globalThis.ResizeObserver = originalResizeObserver;
  globalThis.Uint8Array = originalUint8Array;
});

it('preserves programmatic normalization while importing an unchanged phrase', async () => {
  const user = userEvent.setup();
  mount();
  await enterPhrase(user, `  ${PHRASE_A.toUpperCase().replace(/ /g, '  ')}  `);
  await user.click(importButton());
  await screen.findByText('Password step');
  expectDraft('/create-password-import', 'A');
});

it.each([false, true])(
  'accepts delayed unchanged input and preserves recovery context (%s)',
  async (recovery) => {
    const user = userEvent.setup();
    mount();
    if (recovery) {
      await user.click(
        screen.getByRole('button', { name: 'Begin synthetic recovery' })
      );
    }
    await enterPhrase(user, PHRASE_A);
    const gate = holdFinalCheck(PHRASE_A);
    await user.click(importButton());
    await waitFor(() => expect(gate.held).toBe(true));
    expectDraft('/import', 'none');
    await act(async () => gate.resolve(true));
    expectDraft('/create-password-import', 'A');
    expect(screen.getByTestId('recovery-ticket')).toHaveTextContent(
      recovery ? 'present' : 'absent'
    );
  }
);

it.each([
  { name: 'replacement phrase', replacement: PHRASE_B },
  { name: 'empty phrase', replacement: '' },
])(
  'does not admit a stale final reply after editing or clearing the input ($name)',
  async ({ replacement }) => {
    const user = userEvent.setup();
    mount();
    await enterPhrase(user, PHRASE_A);
    const gate = holdFinalCheck(PHRASE_A);
    await user.click(importButton());
    await waitFor(() => expect(gate.held).toBe(true));
    await enterPhrase(user, replacement);
    await act(async () => gate.resolve(true));
    expectDraft('/import', 'none');
  }
);

it.each(['old first', 'old fails first', 'new first'])(
  'allows resubmission before the old reply and retains the newer draft (%s)',
  async (order) => {
    const user = userEvent.setup();
    mount();
    await enterPhrase(user, PHRASE_A);
    const oldGate = holdFinalCheck(PHRASE_A);
    await user.click(importButton());
    await waitFor(() => expect(oldGate.held).toBe(true));

    await enterPhrase(user, PHRASE_B);
    const newGate = holdFinalCheck(PHRASE_B);
    await user.click(importButton());
    await waitFor(() => expect(newGate.held).toBe(true));

    if (order !== 'new first') {
      await act(async () => {
        if (order === 'old fails first') {
          oldGate.reject(new Error('Synthetic validation transport failure'));
        } else {
          oldGate.resolve(true);
        }
      });
      expectDraft('/import', 'none');
      await user.click(importButton());
      // The duplicate performs field validation only: the old finally must not
      // release the newer submission's pending guard.
      await waitFor(() => expect(newGate.calls).toBe(3));
      await act(async () => newGate.resolve(true));
    } else {
      await act(async () => newGate.resolve(true));
      await act(async () => oldGate.resolve(true));
    }
    expectDraft('/create-password-import', 'B');
  }
);

it('does not admit a delayed final reply after the document is discarded', async () => {
  const user = userEvent.setup();
  mount();
  await enterPhrase(user, PHRASE_A);
  const gate = holdFinalCheck(PHRASE_A);
  await user.click(importButton());
  await waitFor(() => expect(gate.held).toBe(true));
  fireEvent(window, new Event('pagehide'));
  await act(async () => gate.resolve(true));
  expectDraft('/', 'none');
});
