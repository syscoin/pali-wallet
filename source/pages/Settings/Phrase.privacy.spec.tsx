/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import PhraseView from './Phrase';

const seed = 'synthetic alpha beta gamma delta epsilon';
const mockTranslate = (key: string) => key;
const mockEmitter = jest.fn();
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: mockTranslate }),
}));
jest.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/settings/phrase' }),
}));
jest.mock('hooks/index', () => ({
  useUtils: () => ({ navigate: jest.fn() }),
}));
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('utils/navigationState', () => ({ navigateBack: jest.fn() }));
jest.mock('components/Icon/Icon', () => ({ LoadingSvg: () => <svg /> }));
jest.mock('components/index', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  Button: jest.requireActual('components/Button/Button').Button,
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  ValidatedPasswordInput: jest.requireActual(
    'components/Input/ValidatedPasswordInput'
  ).ValidatedPasswordInput,
  SeedPhraseDisplay: jest.requireActual('components/Input/SeedPhraseDisplay')
    .SeedPhraseDisplay,
}));

const originalMessageChannel = globalThis.MessageChannel;
const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  window.matchMedia = jest.fn().mockImplementation(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  }));
  globalThis.MessageChannel = class {
    port1 = { onmessage: undefined as (() => void) | undefined };
    port2 = {
      postMessage: () => setTimeout(() => this.port1.onmessage?.(), 0),
    };
  } as unknown as typeof MessageChannel;
});
afterAll(() => {
  globalThis.MessageChannel = originalMessageChannel;
  window.matchMedia = originalMatchMedia;
});
beforeEach(() => mockEmitter.mockReset().mockResolvedValue(seed));

const enterPassword = (password = 'synthetic password') => {
  fireEvent.change(document.getElementById('phraseview_password')!, {
    target: { value: password },
  });
};
const confirmPassword = () =>
  fireEvent.click(screen.getByRole('button', { name: 'buttons.confirm' }));

it('keeps a delayed authenticated seed masked until Show and masks it again on Hide', async () => {
  let resolve!: (value: string) => void;
  mockEmitter.mockReturnValueOnce(
    new Promise<string>((done) => {
      resolve = done;
    })
  );
  render(<PhraseView />);
  enterPassword();
  confirmPassword();
  expect(screen.queryByRole('button', { name: 'Show' })).toBeNull();
  expect(screen.getByRole('textbox')).not.toHaveValue(seed);
  await act(async () => resolve(seed));
  expect(mockEmitter).toHaveBeenCalledWith(
    ['wallet', 'getSeed'],
    ['synthetic password']
  );
  const show = await screen.findByRole('button', { name: 'Show' });
  expect(screen.getByRole('textbox')).not.toHaveValue(seed);
  fireEvent.click(show);
  expect(screen.getByRole('textbox')).toHaveValue(seed);
  fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
  expect(screen.getByRole('textbox')).not.toHaveValue(seed);
  expect(screen.getByRole('button', { name: 'Show' })).toBeVisible();
});

it('clears a revealed seed on password edit and requires a fresh Show after reauthentication', async () => {
  render(<PhraseView />);
  enterPassword();
  confirmPassword();
  fireEvent.click(await screen.findByRole('button', { name: 'Show' }));
  expect(screen.getByRole('textbox')).toHaveValue(seed);
  enterPassword('');
  expect(screen.getByRole('textbox')).not.toHaveValue(seed);
  expect(screen.queryByRole('button', { name: 'Show' })).toBeNull();
  enterPassword();
  confirmPassword();
  const show = await screen.findByRole('button', { name: 'Show' });
  expect(screen.getByRole('textbox')).not.toHaveValue(seed);
  fireEvent.click(show);
  expect(screen.getByRole('textbox')).toHaveValue(seed);
  expect(mockEmitter).toHaveBeenCalledTimes(2);
});
