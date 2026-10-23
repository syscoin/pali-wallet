/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { PasswordForm } from './PasswordForm';

jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button').Button,
  LogoHeader: () => null,
  Tooltip: ({ children }: any) => children,
}));
jest.mock('components/Icon/Icon', () => ({
  QuestionCircleOutlined: () => <svg aria-hidden="true" />,
  LoadingSvg: () => <svg aria-hidden="true" />,
}));
jest.mock('utils/memorablePassword', () => ({
  generateMemorablePassword: () => 'SuggestedSynthetic!2042',
}));

const messages = [
  ['en', 'Passwords do not match'],
  ['de', 'Die Passwörter stimmen nicht überein.'],
  ['es', 'Las contraseñas no coinciden'],
  ['pt', 'As senhas não coincidem'],
  ['fr', 'Les mots de passe ne correspondent pas'],
  ['ru', 'Пароли не совпадают'],
  ['zh', '两次输入的密码不一致'],
  ['ja', 'パスワードが一致しません'],
  ['ko', '비밀번호가 일치하지 않습니다'],
] as const;
const PASSWORD = 'SyntheticStrong!2042';
const MISMATCH = 'DifferentStrong!2042';
let language!: typeof import('utils/i18n');
let storedLanguage = 'de';
const originalMatchMedia = window.matchMedia;
const originalMessageChannel = globalThis.MessageChannel;

const input = () =>
  screen.getByPlaceholderText(language.i18next.t('components.newPassword'));
const confirmation = () =>
  screen.getByPlaceholderText(language.i18next.t('components.confirmPassword'));
const next = () =>
  screen.getByRole('button', { name: language.i18next.t('buttons.next') });
const fill = async (
  user: ReturnType<typeof userEvent.setup>,
  password = PASSWORD,
  repeated = password
) => {
  await user.type(input(), password);
  await user.type(confirmation(), repeated);
};

beforeAll(async () => {
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => queueMicrotask(() => this.port1.onmessage?.()),
    };
  } as any;
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  }));
  jest
    .mocked(chrome.storage.local.get)
    .mockImplementation(((
      _keys: unknown,
      callback: (items: { language: string }) => void
    ) => callback({ language: storedLanguage })) as any);
  jest.mocked(chrome.storage.local.set).mockImplementation(((
    values: { language: string },
    callback: () => void
  ) => {
    storedLanguage = values.language;
    callback();
  }) as any);
  // The real startup restores the same public language preference written by
  // Languages/changeLanguage. PasswordForm is shared by ordinary onboarding
  // and import/recovery; no wallet creation, key generation or reset runs here.
  language = await import('utils/i18n');
  await waitFor(() => expect(language.i18next.resolvedLanguage).toBe('de'));
});
beforeEach(async () => {
  jest.clearAllMocks();
  await language.changeLanguage('de');
});
afterEach(() => cleanup());
afterAll(() => {
  window.matchMedia = originalMatchMedia;
  globalThis.MessageChannel = originalMessageChannel;
});

it.each(messages)(
  'shows confirmation mismatch in the saved %s locale without submitting',
  async (locale, expected) => {
    await language.changeLanguage(locale);
    expect(storedLanguage).toBe(locale);
    expect(language.i18next.resolvedLanguage).toBe(locale);
    const submit = jest.fn();
    const user = userEvent.setup();
    render(<PasswordForm onSubmit={submit} />);
    expect(
      screen.getByRole('heading', {
        name: language.i18next.t('settings.password'),
      })
    ).toBeVisible();
    await fill(user, PASSWORD, MISMATCH);
    expect(await screen.findByText(expected)).toBeVisible();
    if (locale !== 'en') expect(screen.queryByText(messages[0][1])).toBeNull();
    expect(next()).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
  }
);

it('keeps a matching strong German confirmation usable and submits exact inputs once', async () => {
  const submit = jest.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(<PasswordForm onSubmit={submit} />);
  expect(next()).toBeDisabled();
  await fill(user);
  await waitFor(() => expect(next()).toBeEnabled());
  await user.click(next());
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(submit).toHaveBeenCalledWith({
    password: PASSWORD,
    repassword: PASSWORD,
  });
  expect(screen.queryByText(messages[1][1])).toBeNull();
});

it('retains the strong-password restriction even when weak inputs match', async () => {
  const submit = jest.fn();
  const user = userEvent.setup();
  render(<PasswordForm onSubmit={submit} />);
  await fill(user, 'weak');
  await waitFor(() =>
    expect(input().closest('.ant-form-item')).toHaveClass(
      'ant-form-item-has-error'
    )
  );
  expect(next()).toBeDisabled();
  expect(submit).not.toHaveBeenCalled();
});

it('disables Next after a valid confirmation is cleared, without a stale mismatch message', async () => {
  const submit = jest.fn();
  const user = userEvent.setup();
  render(<PasswordForm onSubmit={submit} />);
  await fill(user);
  await waitFor(() => expect(next()).toBeEnabled());
  await user.clear(confirmation());
  await waitFor(() => expect(next()).toBeDisabled());
  expect(screen.queryByText(messages[1][1])).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});

it('retains localized failed-submit feedback and allows the same valid inputs to be retried', async () => {
  const submit = jest
    .fn()
    .mockRejectedValueOnce(new Error('Synthetic private exception details'))
    .mockResolvedValueOnce(undefined);
  const user = userEvent.setup();
  render(<PasswordForm onSubmit={submit} />);
  await fill(user);
  await waitFor(() => expect(next()).toBeEnabled());
  await user.click(next());
  expect(await screen.findByRole('alert')).toHaveTextContent(
    language.i18next.t('settings.walletSetupFailed')
  );
  expect(screen.queryByText('Synthetic private exception details')).toBeNull();
  await waitFor(() => expect(next()).toBeEnabled());
  expect(input()).toHaveValue(PASSWORD);
  expect(confirmation()).toHaveValue(PASSWORD);
  await user.click(next());
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
});

it('keeps suggested passwords unconfirmed until the user fills confirmation again', async () => {
  const submit = jest.fn();
  const user = userEvent.setup();
  render(<PasswordForm onSubmit={submit} />);
  await fill(user);
  await waitFor(() => expect(next()).toBeEnabled());
  await user.click(
    screen.getByRole('button', {
      name: language.i18next.t('components.suggestPassword'),
    })
  );
  await waitFor(() => expect(next()).toBeDisabled());
  expect(input()).toHaveValue('SuggestedSynthetic!2042');
  expect(confirmation()).toHaveValue('');
  expect(submit).not.toHaveBeenCalled();
  await act(async () => undefined);
});
