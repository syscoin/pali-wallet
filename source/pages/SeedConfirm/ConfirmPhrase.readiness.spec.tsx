/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createInstance } from 'i18next';
import React, { useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import en from 'assets/locales/en.json';

import { ConfirmPhrase } from './ConfirmPhrase';

// Deliberately invalid, public synthetic words: no wallet secret is generated.
const WORDS = Array.from({ length: 12 }, (_, index) => `syntheticWord${index}`);
const SEED = WORDS.join(' ');
const mockSetPassed = jest.fn();
const mockConfirmPassed = jest.fn();

// Keep the actual shared Button and its native disabled/event contract. The
// package aliases resolve actual CJS code without replacing any Button output.
jest.mock('@ant-design/colors', () =>
  jest.requireActual('@ant-design/colors/lib')
);
jest.mock('@ant-design/colors/es/generate', () =>
  jest.requireActual('@ant-design/colors/lib/generate')
);
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button/Button').Button,
}));
jest.mock('components/Layout/OnboardingLayout', () => ({
  OnboardingLayout: ({ children, title }: any) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
jest.mock('components/ToastActionFooter', () => ({
  ToastActionFooter: ({ children }: any) => <footer>{children}</footer>,
}));
jest.mock('components/Modal/StatusModal', () => ({
  StatusModal: ({ show, description, onClose }: any) =>
    show ? (
      <div role="alert">
        {description}
        <button type="button" onClick={onClose}>
          Close test error
        </button>
      </div>
    ) : null,
}));
jest.mock('components/Modal/WarningBaseModal', () => ({
  WalletReadyModal: ({ show, onClose }: any) =>
    show ? (
      <div role="dialog" aria-label="Test wallet-ready terminal">
        <button type="button" onClick={() => void onClose()}>
          Complete test confirmation
        </button>
      </div>
    ) : null,
}));

const Fixture = () => {
  const [passed, setPassed] = useState(false);
  return (
    <ConfirmPhrase
      seed={SEED}
      passed={passed}
      setPassed={(value) => {
        mockSetPassed(value);
        setPassed(value);
      }}
      confirmPassed={mockConfirmPassed}
    />
  );
};

const mount = async () => {
  const instance = createInstance();
  await instance.use(initReactI18next).init({
    initImmediate: false,
    lng: 'en',
    fallbackLng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  const user = userEvent.setup();
  const view = render(
    <I18nextProvider i18n={instance}>
      <Fixture />
    </I18nextProvider>
  );
  const sections = view.container.querySelectorAll('section');
  expect(sections).toHaveLength(2);
  const selected = sections[0];
  const available = sections[1];
  const validate = screen.getByRole('button', { name: en.buttons.validate });
  expect(validate).toBeInstanceOf(HTMLButtonElement);
  expect(validate).toHaveAttribute('type', 'button');
  const selectWords = async (words: string[]) => {
    for (const word of words)
      await user.click(within(available).getByRole('button', { name: word }));
  };
  const validateByKeyboard = async () => {
    validate.focus();
    expect(validate).toHaveFocus();
    await user.keyboard('{Enter}');
  };
  return {
    user,
    selected,
    available,
    validate,
    selectWords,
    validateByKeyboard,
  };
};

beforeEach(() => {
  mockSetPassed.mockReset();
  mockConfirmPassed.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

it('makes initial Validate natively unavailable before any word is selected', async () => {
  const { user, selected, available, validate } = await mount();
  expect(within(selected).queryAllByRole('button')).toHaveLength(0);
  expect(within(available).getAllByRole('button')).toHaveLength(12);
  await user.click(validate);
  expect(mockSetPassed).not.toHaveBeenCalled();
  expect(mockConfirmPassed).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(validate).toBeDisabled();
});

it('keeps partial selection unavailable without confirming or completing setup', async () => {
  const { user, selected, available, validate, selectWords } = await mount();
  await selectWords(WORDS.slice(0, 1));
  expect(within(selected).getAllByRole('button')).toHaveLength(1);
  expect(within(available).getAllByRole('button')).toHaveLength(11);
  await user.click(validate);
  expect(mockSetPassed).not.toHaveBeenCalled();
  expect(mockConfirmPassed).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(validate).toBeDisabled();
});

it('enables all-selected correct order and completes only through the ready terminal', async () => {
  const {
    user,
    selected,
    available,
    validate,
    selectWords,
    validateByKeyboard,
  } = await mount();
  await selectWords(WORDS);
  expect(within(available).queryAllByRole('button')).toHaveLength(0);
  expect(
    within(selected)
      .getAllByRole('button')
      .map((button) => button.textContent)
  ).toEqual(WORDS);
  expect(validate).toBeEnabled();
  expect(mockSetPassed).not.toHaveBeenCalled();
  expect(mockConfirmPassed).not.toHaveBeenCalled();
  await validateByKeyboard();
  expect(mockSetPassed.mock.calls).toEqual([[true]]);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mockConfirmPassed).not.toHaveBeenCalled();
  const complete = within(
    screen.getByRole('dialog', { name: 'Test wallet-ready terminal' })
  ).getByRole('button', { name: 'Complete test confirmation' });
  complete.focus();
  await user.keyboard('{Enter}');
  expect(mockConfirmPassed).toHaveBeenCalledTimes(1);
});

it('keeps complete wrong order actionable for error feedback without accepting it', async () => {
  const { user, validate, selectWords, validateByKeyboard } = await mount();
  await selectWords([...WORDS].reverse());
  expect(validate).toBeEnabled();
  await validateByKeyboard();
  expect(mockSetPassed.mock.calls).toEqual([[false]]);
  expect(screen.getByRole('alert')).toHaveTextContent(en.seedConfirm.seedError);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mockConfirmPassed).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Close test error' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mockSetPassed.mock.calls).toEqual([[false]]);
});

it('makes Validate unavailable again when a selected word is returned', async () => {
  const { user, selected, available, validate, selectWords } = await mount();
  await selectWords(WORDS);
  expect(validate).toBeEnabled();
  await user.click(
    within(selected).getByRole('button', { name: WORDS[WORDS.length - 1] })
  );
  expect(within(selected).getAllByRole('button')).toHaveLength(11);
  expect(within(available).getAllByRole('button')).toHaveLength(1);
  expect(mockSetPassed).not.toHaveBeenCalled();
  expect(mockConfirmPassed).not.toHaveBeenCalled();
  expect(validate).toBeDisabled();
});

it('accepts the same exact correct order after returning and reselecting its last word', async () => {
  const { user, selected, validate, selectWords, validateByKeyboard } =
    await mount();
  const lastWord = WORDS[WORDS.length - 1];
  await selectWords(WORDS);
  await user.click(within(selected).getByRole('button', { name: lastWord }));
  await selectWords([lastWord]);
  expect(
    within(selected)
      .getAllByRole('button')
      .map((button) => button.textContent)
  ).toEqual(WORDS);
  expect(validate).toBeEnabled();
  await validateByKeyboard();
  expect(mockSetPassed.mock.calls).toEqual([[true]]);
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(mockConfirmPassed).not.toHaveBeenCalled();
});
