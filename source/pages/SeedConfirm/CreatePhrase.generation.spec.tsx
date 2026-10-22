/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';

import {
  OnboardingSecretsProvider,
  useOnboardingSecrets,
} from 'hooks/useOnboardingSecrets';

import { SeedConfirm } from '.';

// Deliberately invalid synthetic phrases: no real wallet secret is generated.
const phrase = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(' ');
const TWELVE = phrase('synthetic-twelve-', 12);
const ANOTHER_TWELVE = phrase('synthetic-replacement-', 12);
const TWENTY_FOUR = phrase('synthetic-twenty-four-', 24);
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
        beginCreate('Synthetic-only-password-729!');
        navigate('/phrase');
      }}
    >
      Begin setup
    </button>
  );
};
const mount = () =>
  render(
    <MemoryRouter initialEntries={['/create-password']}>
      <OnboardingSecretsProvider>
        <Link to="/home">Leave setup</Link>
        <Routes>
          <Route path="/create-password" element={<Begin />} />
          <Route path="/phrase" element={<SeedConfirm />} />
          <Route path="/home" element={<p>Wallet home</p>} />
        </Routes>
      </OnboardingSecretsProvider>
    </MemoryRouter>
  );
const deferred = () => {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const begin = async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Begin setup' }));
  await screen.findByText(TWELVE);
};
const acknowledgeAndNext = () => {
  (screen.getByRole('checkbox') as HTMLInputElement).click();
  (
    screen.getByRole('button', { name: 'buttons.next' }) as HTMLButtonElement
  ).click();
};
beforeEach(() => {
  mockEmitter.mockReset().mockResolvedValueOnce(TWELVE);
});

it('names the phrase word-count selector through ordinary regeneration', async () => {
  mockEmitter.mockResolvedValueOnce(TWENTY_FOUR);
  await begin();
  const selector = screen.getByRole('combobox');
  expect(selector).toHaveValue('12');
  expect(selector).toHaveAccessibleName('Words');
  fireEvent.change(selector, { target: { value: '24' } });
  await screen.findByText(TWENTY_FOUR);
  expect(selector).toHaveValue('24');
  expect(selector).toHaveAccessibleName('Words');
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['wallet', 'createNewSeed'],
    [24]
  );
});

it('cannot confirm a previous twelve-word phrase while the selected twenty-four-word generation is pending', async () => {
  const generation = deferred();
  mockEmitter.mockReturnValueOnce(generation.promise);
  await begin();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '24' } });
  expect(mockEmitter).toHaveBeenLastCalledWith(
    ['wallet', 'createNewSeed'],
    [24]
  );
  await act(async () => acknowledgeAndNext());
  expect(screen.queryByTestId('confirm-phrase')).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'buttons.next' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  await act(async () => generation.resolve(TWENTY_FOUR));
  expect(screen.getByTestId('displayed-phrase').textContent).toBe(TWENTY_FOUR);
});

it('does not let an older manual Generate reply replace the currently selected twenty-four-word phrase', async () => {
  const oldGeneration = deferred();
  mockEmitter
    .mockReturnValueOnce(oldGeneration.promise)
    .mockResolvedValueOnce(TWENTY_FOUR);
  await begin();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.generate' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '24' } });
  await screen.findByText(TWENTY_FOUR);
  await act(async () => oldGeneration.resolve(ANOTHER_TWELVE));
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('24');
  expect(screen.getByTestId('displayed-phrase').textContent).toBe(TWENTY_FOUR);
});

it('confirms the healthy current twenty-four-word generation only after its own acknowledgement', async () => {
  mockEmitter.mockResolvedValueOnce(TWENTY_FOUR);
  await begin();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '24' } });
  await screen.findByText(TWENTY_FOUR);
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(
    false
  );
  expect(
    (screen.getByRole('button', { name: 'buttons.next' }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
  await act(async () => acknowledgeAndNext());
  expect(screen.getByTestId('confirm-phrase').textContent).toBe(TWENTY_FOUR);
});

it('blocks acknowledgement and Next while manual generation is pending and requires the replacement acknowledgement', async () => {
  const generation = deferred();
  mockEmitter.mockReturnValueOnce(generation.promise);
  await begin();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.generate' }));
  await act(async () => acknowledgeAndNext());
  expect(screen.queryByTestId('confirm-phrase')).toBeNull();
  expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(
    true
  );
  await act(async () => generation.resolve(ANOTHER_TWELVE));
  expect(screen.getByTestId('displayed-phrase').textContent).toBe(
    ANOTHER_TWELVE
  );
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(
    false
  );
  await act(async () => acknowledgeAndNext());
  expect(screen.getByTestId('confirm-phrase').textContent).toBe(ANOTHER_TWELVE);
});

it('keeps the newest manual generation when two Generate replies settle out of order', async () => {
  const older = deferred();
  const latest = deferred();
  mockEmitter
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(latest.promise);
  await begin();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.generate' }));
  fireEvent.click(screen.getByRole('button', { name: 'buttons.generate' }));
  await act(async () => latest.resolve(ANOTHER_TWELVE));
  await act(async () => older.resolve(TWELVE));
  expect(screen.getByTestId('displayed-phrase').textContent).toBe(
    ANOTHER_TWELVE
  );
  expect(screen.queryByText('buttons.loading')).toBeNull();
});

it.each(['initial', 'manual'])(
  'keeps a current %s generation failure settled until explicit Generate retry',
  async (kind) => {
    const error = new Error('Synthetic generation failure details');
    if (kind === 'initial') {
      mockEmitter
        .mockReset()
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce(TWELVE);
      mount();
      fireEvent.click(screen.getByRole('button', { name: 'Begin setup' }));
    } else {
      await begin();
      mockEmitter.mockRejectedValueOnce(error).mockResolvedValueOnce(TWELVE);
      fireEvent.click(screen.getByRole('button', { name: 'buttons.generate' }));
    }
    await screen.findByRole('alert');
    expect(screen.getByRole('alert').textContent).toBe(
      'settings.walletSetupFailed'
    );
    expect(screen.queryByText(error.message)).toBeNull();
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(
      true
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'buttons.next',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    const calls = mockEmitter.mock.calls.length;
    await act(async () => Promise.resolve());
    expect(mockEmitter).toHaveBeenCalledTimes(calls);
    fireEvent.click(screen.getByRole('button', { name: 'buttons.generate' }));
    await screen.findByText(TWELVE);
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => acknowledgeAndNext());
    expect(screen.getByTestId('confirm-phrase').textContent).toBe(TWELVE);
  }
);

it('ignores an old manual failure after a newer word-count generation succeeds', async () => {
  const older = deferred();
  mockEmitter
    .mockReturnValueOnce(older.promise)
    .mockResolvedValueOnce(TWENTY_FOUR);
  await begin();
  fireEvent.click(screen.getByRole('button', { name: 'buttons.generate' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: '24' } });
  await screen.findByText(TWENTY_FOUR);
  await act(async () => older.reject(new Error('Previous generation failed')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByTestId('displayed-phrase').textContent).toBe(TWENTY_FOUR);
  await act(async () => acknowledgeAndNext());
  expect(screen.getByTestId('confirm-phrase').textContent).toBe(TWENTY_FOUR);
});

it.each(['success', 'failure'])(
  'ignores manual generation %s after leaving the actual setup route',
  async (result) => {
    const generation = deferred();
    mockEmitter.mockReturnValueOnce(generation.promise);
    await begin();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.generate' }));
    fireEvent.click(screen.getByRole('link', { name: 'Leave setup' }));
    expect(screen.getByText('Wallet home')).toBeTruthy();
    await act(async () => {
      if (result === 'success') generation.resolve(ANOTHER_TWELVE);
      else generation.reject(new Error('Retired generation failure'));
    });
    expect(screen.getByText('Wallet home')).toBeTruthy();
    expect(screen.queryByTestId('displayed-phrase')).toBeNull();
    expect(screen.queryByTestId('confirm-phrase')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  }
);
