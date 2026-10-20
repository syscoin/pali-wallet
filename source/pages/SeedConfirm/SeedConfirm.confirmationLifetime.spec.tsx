/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';

import {
  OnboardingSecretsProvider,
  useOnboardingSecrets,
} from 'hooks/useOnboardingSecrets';
import { SeedConfirm } from 'pages/SeedConfirm';

// Intentionally invalid synthetic words. No real wallet secret is generated.
const phrase = (prefix: string) =>
  Array.from({ length: 12 }, (_, i) => `${prefix}${i}`).join(' ');
const FIRST = phrase('syntheticA');
const SECOND = phrase('syntheticB');
const mockEmitter = jest.fn();
let mockValidate: () => void;
let mockReady: () => Promise<void>;
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('hooks/useUtils', () => ({
  useUtils: () => ({ navigate: useNavigate(), alert: { error: jest.fn() } }),
}));
jest.mock('hooks/controllerStatus', () => ({
  refreshControllerStatus: () => Promise.resolve(true),
}));
jest.mock('utils/reloadWalletForRecovery', () => ({
  reloadWalletForRecovery: jest.fn(),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('components/index', () => ({
  Button: ({ children, disabled, onClick, type }: any) => {
    if (children === 'buttons.validate') mockValidate = onClick;
    return (
      <button type={type} disabled={disabled} onClick={onClick}>
        {children}
      </button>
    );
  },
  SeedPhraseDisplay: ({ seedPhrase }: any) => (
    <output data-testid="displayed-phrase">{seedPhrase}</output>
  ),
}));
jest.mock('components/Layout/OnboardingLayout', () => ({
  OnboardingLayout: ({ children }: any) => <>{children}</>,
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <>{children}</>,
}));
jest.mock('components/Modal/StatusModal', () => ({
  StatusModal: ({ show }: any) =>
    show ? <div role="alert">Invalid confirmation</div> : null,
}));
jest.mock('components/Modal/WarningBaseModal', () => ({
  WalletReadyModal: ({ show, onClose }: any) => {
    if (show) mockReady = onClose;
    return show ? (
      <button onClick={() => onClose(false)}>
        Complete synthetic creation
      </button>
    ) : null;
  },
}));

const Begin = () => {
  const { beginCreate } = useOnboardingSecrets();
  const navigate = useNavigate();
  return (
    <button
      onClick={() => {
        beginCreate('Synthetic-only-password-729!');
        navigate('/phrase');
      }}
    >
      Begin
    </button>
  );
};
const Navigation = () => {
  const navigate = useNavigate();
  const { setCreatedPhrase } = useOnboardingSecrets();
  return (
    <>
      <button onClick={() => navigate(-1)}>Native Back</button>
      <button onClick={() => setCreatedPhrase(SECOND)}>
        Replace live phrase
      </button>
    </>
  );
};
const start = async () => {
  const view = render(
    <MemoryRouter initialEntries={['/create-password']}>
      <OnboardingSecretsProvider>
        <Navigation />
        <Routes>
          <Route path="/create-password" element={<Begin />} />
          <Route path="/phrase" element={<SeedConfirm />} />
          <Route path="/home" element={<p>Home</p>} />
        </Routes>
      </OnboardingSecretsProvider>
    </MemoryRouter>
  );
  fireEvent.click(screen.getByRole('button', { name: 'Begin' }));
  await screen.findByText(FIRST);
  return view;
};
const next = () => {
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.next' }));
};
const verifyWords = (seed: string) => {
  for (const word of seed.split(' '))
    fireEvent.click(screen.getByRole('button', { name: word }));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.validate' }));
};
beforeEach(() => {
  mockEmitter
    .mockReset()
    .mockImplementation(async ([, method]) =>
      method === 'createNewSeed' ? FIRST : undefined
    );
});

it('requires and accepts actual word confirmation for the initial generated phrase', async () => {
  await start();
  next();
  expect(
    screen.queryByRole('button', { name: 'Complete synthetic creation' })
  ).toBeNull();
  expect(
    mockEmitter.mock.calls.filter(([[, method]]) => method === 'createWallet')
  ).toHaveLength(0);
  verifyWords(FIRST);
  fireEvent.click(
    screen.getByRole('button', { name: 'Complete synthetic creation' })
  );
  await screen.findByText('Home');
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'createWallet'],
    ['Synthetic-only-password-729!', FIRST],
    10000,
    false
  );
});

it('requires a new word confirmation after Back and regeneration before allowing creation', async () => {
  await start();
  next();
  verifyWords(FIRST);
  expect(
    screen.getByRole('button', { name: 'Complete synthetic creation' })
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Native Back' }));
  await screen.findByText(FIRST);
  mockEmitter.mockResolvedValueOnce(SECOND);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.generate' }));
  await screen.findByText(SECOND);
  next();
  // Check actual dispatch as well as the modal state, without using any real wallet.
  const bypass = screen.queryByRole('button', {
    name: 'Complete synthetic creation',
  });
  if (bypass) {
    await act(async () => fireEvent.click(bypass));
    await waitFor(() =>
      expect(
        mockEmitter.mock.calls.some(([[, method]]) => method === 'createWallet')
      ).toBe(true)
    );
  }
  expect({
    readyWithoutWordConfirmation: Boolean(bypass),
    creationCalls: mockEmitter.mock.calls.filter(
      ([[, method]]) => method === 'createWallet'
    ),
  }).toEqual({ readyWithoutWordConfirmation: false, creationCalls: [] });
  verifyWords(SECOND);
  fireEvent.click(
    screen.getByRole('button', { name: 'Complete synthetic creation' })
  );
  await screen.findByText('Home');
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'createWallet'],
    ['Synthetic-only-password-729!', SECOND],
    10000,
    false
  );
});

it('does not revive an earlier confirmation when phrases change A to B to A', async () => {
  await start();
  next();
  verifyWords(FIRST);
  fireEvent.click(screen.getByRole('button', { name: 'Native Back' }));
  await screen.findByText(FIRST);
  mockEmitter.mockResolvedValueOnce(SECOND);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.generate' }));
  await screen.findByText(SECOND);
  next();
  expect(
    screen.queryByRole('button', { name: 'Complete synthetic creation' })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Native Back' }));
  await screen.findByText(SECOND);
  mockEmitter.mockResolvedValueOnce(FIRST);
  fireEvent.click(screen.getByRole('button', { name: 'buttons.generate' }));
  await screen.findByText(FIRST);
  next();
  expect(
    screen.queryByRole('button', { name: 'Complete synthetic creation' })
  ).toBeNull();
  verifyWords(FIRST);
  expect(
    screen.getByRole('button', { name: 'Complete synthetic creation' })
  ).toBeVisible();
  expect(
    mockEmitter.mock.calls.filter(([[, method]]) => method === 'createWallet')
  ).toHaveLength(0);
});

it('preserves a completed confirmation across Back and Next for the unchanged phrase', async () => {
  await start();
  next();
  verifyWords(FIRST);
  fireEvent.click(screen.getByRole('button', { name: 'Native Back' }));
  await screen.findByText(FIRST);
  next();
  expect(
    screen.getByRole('button', { name: 'Complete synthetic creation' })
  ).toBeVisible();
  expect(
    mockEmitter.mock.calls.filter(([[, method]]) => method === 'createNewSeed')
  ).toHaveLength(1);
});

it('rejects an invalid word order and accepts a later correct order', async () => {
  await start();
  next();
  verifyWords(FIRST.split(' ').reverse().join(' '));
  expect(screen.getByRole('alert')).toHaveTextContent('Invalid confirmation');
  expect(
    screen.queryByRole('button', { name: 'Complete synthetic creation' })
  ).toBeNull();
  for (const word of FIRST.split(' '))
    fireEvent.click(screen.getByRole('button', { name: word }));
  verifyWords(FIRST);
  expect(
    screen.getByRole('button', { name: 'Complete synthetic creation' })
  ).toBeVisible();
  expect(
    mockEmitter.mock.calls.filter(([[, method]]) => method === 'createWallet')
  ).toHaveLength(0);
});

it('discards delayed old validation and ready callbacks after a live phrase replacement', async () => {
  await start();
  next();
  verifyWords(FIRST);
  const oldValidate = mockValidate;
  const oldReady = mockReady;
  fireEvent.click(screen.getByRole('button', { name: 'Replace live phrase' }));
  expect(
    screen.queryByRole('button', { name: FIRST.split(' ')[0] })
  ).toBeNull();
  expect(
    screen.getByRole('button', { name: SECOND.split(' ')[0] })
  ).toBeVisible();
  await act(async () => {
    oldValidate();
    await oldReady();
  });
  expect(
    screen.queryByRole('button', { name: 'Complete synthetic creation' })
  ).toBeNull();
  expect(
    mockEmitter.mock.calls.filter(([[, method]]) => method === 'createWallet')
  ).toHaveLength(0);
  verifyWords(SECOND);
  expect(
    screen.getByRole('button', { name: 'Complete synthetic creation' })
  ).toBeVisible();
});

it('discards a delayed ready callback after the setup view unmounts', async () => {
  const view = await start();
  next();
  verifyWords(FIRST);
  const oldReady = mockReady;
  view.unmount();
  await oldReady();
  expect(
    mockEmitter.mock.calls.filter(([[, method]]) => method === 'createWallet')
  ).toHaveLength(0);
});

it('rejects a delayed ready callback after the current confirmation is revoked', async () => {
  await start();
  next();
  verifyWords(FIRST);
  const oldReady = mockReady;
  for (const word of FIRST.split(' '))
    fireEvent.click(screen.getByRole('button', { name: word }));
  verifyWords(FIRST.split(' ').reverse().join(' '));
  expect(
    screen.queryByRole('button', { name: 'Complete synthetic creation' })
  ).toBeNull();
  await oldReady();
  expect(
    mockEmitter.mock.calls.filter(([[, method]]) => method === 'createWallet')
  ).toHaveLength(0);
});
