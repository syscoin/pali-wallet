/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';

import {
  OnboardingSecretsProvider,
  useOnboardingSecrets,
} from 'hooks/useOnboardingSecrets';

import { SeedConfirm } from '.';

const PASSWORD = 'Synthetic-only-password-729!';
const PHRASE = Array.from(
  { length: 12 },
  (_, index) => `synthetic${index}`
).join(' ');
const SECOND_PHRASE = Array.from(
  { length: 12 },
  (_, index) => `other${index}`
).join(' ');
const mockEmitter = jest.fn();

jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ navigate: useNavigate(), alert: { error: jest.fn() } }),
}));
jest.mock('hooks/controllerStatus', () => ({
  refreshControllerStatus: jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/index', () => ({
  Button: ({ children, disabled, onClick }: any) => (
    <button disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  SeedPhraseDisplay: ({ seedPhrase }: any) => (
    <output data-testid="displayed-phrase">{seedPhrase}</output>
  ),
}));
jest.mock('components/Layout/OnboardingLayout', () => ({
  OnboardingLayout: ({ children }: any) => <>{children}</>,
}));
jest.mock('./ConfirmPhrase', () => ({
  ConfirmPhrase: ({ seed }: any) => (
    <output data-testid="confirm-phrase">{seed}</output>
  ),
}));

const Begin = () => {
  const { beginCreate } = useOnboardingSecrets();
  const navigate = useNavigate();
  return (
    <button
      onClick={() => {
        beginCreate(PASSWORD);
        navigate('/phrase');
      }}
    >
      Begin wallet setup
    </button>
  );
};
const Probe = () => {
  const { secrets } = useOnboardingSecrets();
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <output data-testid="live-secrets">{JSON.stringify(secrets)}</output>
      <output data-testid="current-route">{location.pathname}</output>
      <button onClick={() => navigate('/home')}>Leave setup</button>
    </>
  );
};
const mount = (strict = false) => {
  const tree = (
    <BrowserRouter>
      <OnboardingSecretsProvider>
        <Probe />
        <Routes>
          <Route path="/" element={<Begin />} />
          <Route path="/create-password" element={<Begin />} />
          <Route path="/phrase" element={<SeedConfirm />} />
          <Route path="/home" element={<p>Wallet home</p>} />
        </Routes>
      </OnboardingSecretsProvider>
    </BrowserRouter>
  );
  return render(strict ? <React.StrictMode>{tree}</React.StrictMode> : tree);
};
const beginAndConfirm = async (expectedPhrase = PHRASE, wordCount = 12) => {
  fireEvent.click(screen.getByText('Begin wallet setup'));
  await waitFor(() =>
    expect(screen.getByTestId('displayed-phrase').textContent).toBe(PHRASE)
  );
  if (wordCount !== 12) {
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: String(wordCount) },
    });
  }
  await waitFor(() =>
    expect(screen.getByTestId('displayed-phrase').textContent).toBe(
      expectedPhrase
    )
  );
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.next' }));
  expect(screen.getByTestId('confirm-phrase').textContent).toBe(expectedPhrase);
};
const expectNoPersistedSecrets = () => {
  const persisted = JSON.stringify({
    history: window.history.state,
    url: window.location.href,
    local: localStorage,
    session: sessionStorage,
  });
  expect(persisted).not.toContain(PASSWORD);
  expect(persisted).not.toContain(PHRASE);
  expect(persisted).not.toContain(SECOND_PHRASE);
};

beforeEach(() => {
  window.history.replaceState(null, '', '/create-password');
  localStorage.clear();
  sessionStorage.clear();
  mockEmitter
    .mockReset()
    .mockResolvedValueOnce(PHRASE)
    .mockResolvedValue(SECOND_PHRASE);
});

it.each([12, 24])(
  'native Back and Forward between the live phrase steps keep the %s-word phrase',
  async (wordCount) => {
    const expectedPhrase = Array.from(
      { length: wordCount },
      (_, index) => `synthetic${index}`
    ).join(' ');
    mockEmitter
      .mockReset()
      .mockResolvedValueOnce(PHRASE)
      .mockResolvedValueOnce(expectedPhrase)
      .mockResolvedValue(SECOND_PHRASE);
    mount();
    await beginAndConfirm(expectedPhrase, wordCount);
    const generationCount = mockEmitter.mock.calls.length;
    expectNoPersistedSecrets();
    act(() => window.history.back());
    await waitFor(() =>
      expect(screen.getByTestId('displayed-phrase').textContent).toBe(
        expectedPhrase
      )
    );
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(
      String(wordCount)
    );
    expect(mockEmitter).toHaveBeenCalledTimes(generationCount);
    expectNoPersistedSecrets();
    act(() => window.history.forward());
    await waitFor(() =>
      expect(screen.getByTestId('confirm-phrase').textContent).toBe(
        expectedPhrase
      )
    );
    expectNoPersistedSecrets();
  }
);

it('initial phrase generation and live Back still work with Strict Mode effect cleanup', async () => {
  mockEmitter.mockReset().mockResolvedValue(PHRASE);
  mount(true);
  await beginAndConfirm();
  const generationCount = mockEmitter.mock.calls.length;
  act(() => window.history.back());
  await waitFor(() =>
    expect(screen.getByTestId('displayed-phrase').textContent).toBe(PHRASE)
  );
  expect(mockEmitter).toHaveBeenCalledTimes(generationCount);
  expectNoPersistedSecrets();
});

it('leaving setup clears the phrase and native Back cannot revive it', async () => {
  mount();
  await beginAndConfirm();
  fireEvent.click(screen.getByText('Leave setup'));
  expect(screen.getByTestId('live-secrets').textContent).toBe('{}');
  act(() => window.history.back());
  await waitFor(() =>
    expect(screen.getByText('Begin wallet setup')).toBeTruthy()
  );
  expect(screen.queryByTestId('displayed-phrase')).toBeNull();
  expect(screen.queryByTestId('confirm-phrase')).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expectNoPersistedSecrets();
});

it('pagehide clears the live phrase and returns to setup landing', async () => {
  mount();
  await beginAndConfirm();
  fireEvent(window, new Event('pagehide'));
  expect(screen.getByTestId('live-secrets').textContent).toBe('{}');
  expect(screen.getByTestId('current-route').textContent).toBe('/');
  expect(screen.queryByTestId('confirm-phrase')).toBeNull();
  expectNoPersistedSecrets();
});

it('reopening the document cannot recover a phrase from the previous document', async () => {
  const first = mount();
  await beginAndConfirm();
  first.unmount();
  mount();
  await waitFor(() =>
    expect(screen.getByText('Begin wallet setup')).toBeTruthy()
  );
  expect(screen.getByTestId('live-secrets').textContent).toBe('{}');
  expect(screen.queryByTestId('displayed-phrase')).toBeNull();
  expect(screen.queryByTestId('confirm-phrase')).toBeNull();
  expect(mockEmitter).toHaveBeenCalledTimes(1);
  expectNoPersistedSecrets();
});
