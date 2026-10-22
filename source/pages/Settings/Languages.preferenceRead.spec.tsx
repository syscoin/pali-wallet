/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import React from 'react';

// Exercise real Languages, HeadlessUI, Ant Form, Button, i18next startup/save,
// and chromeStorage. Only the public Chrome storage I/O and unrelated modal/
// router/icon presentation are replaced; no component state is injected.
jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ pathname: '/settings/languages' }),
}));
jest.mock('components/Icon/Icon', () => ({
  ArrowDownSvg: () => <svg />,
  LoadingSvg: () => <svg />,
}));
jest.mock('components/index', () => ({
  Button: jest.requireActual('components/Button').Button,
  PageActionFooter: jest.requireActual('components/PageActionFooter')
    .PageActionFooter,
  DefaultModal: ({ show, title }: { show: boolean; title: string }) =>
    show ? <div role="dialog">{title}</div> : null,
}));

let Languages!: typeof import('./Languages').default;
let language!: typeof import('utils/i18n');
let stored: string;
let refuseNextRead = false;
let readCallbacks = 0;

const configureStorage = () => {
  jest.mocked(chrome.storage.local.get).mockImplementation(((
    _keys: string[],
    callback: (value: { language?: string }) => void
  ) => {
    readCallbacks += 1;
    if (refuseNextRead) {
      refuseNextRead = false;
      (chrome.runtime as any).lastError = {
        message: 'Synthetic Chrome storage read unavailable',
      };
      callback({});
      delete (chrome.runtime as any).lastError;
    } else callback({ language: stored });
  }) as any);
  jest.mocked(chrome.storage.local.set).mockImplementation(((
    items: { language: string },
    callback: () => void
  ) => {
    stored = items.language;
    callback();
  }) as any);
};

const label = (key: string) => language.i18next.t(key);
const trigger = () =>
  screen.getByRole('button', {
    name: label('settings.setYourPreferredLanguage'),
  });
const save = () => screen.getByRole('button', { name: label('buttons.save') });
const currentCard = () =>
  screen.getByText(label('settings.currentLanguage')).parentElement!;
const choose = async (name: string) => {
  fireEvent.click(trigger());
  fireEvent.click(await screen.findByRole('menuitem', { name }));
};

beforeAll(async () => {
  stored = 'fr';
  configureStorage();
  language = await import('utils/i18n');
  Languages = (await import('./Languages')).default;
  // Actual startup restores the persisted French document before the page
  // performs its independent normal preference read.
  await waitFor(() => expect(language.i18next.language).toBe('fr'));
});

beforeEach(async () => {
  jest.clearAllMocks();
  stored = 'fr';
  refuseNextRead = false;
  readCallbacks = 0;
  configureStorage();
  await language.changeLanguage('fr');
  jest.mocked(chrome.storage.local.set).mockClear();
});

afterEach(() => {
  cleanup();
  delete (chrome.runtime as any).lastError;
});

it('healthy French read agrees with the restored runtime language and saved preference', async () => {
  render(<Languages />);
  await waitFor(() => expect(trigger().textContent).toContain('Français'));
  expect(within(currentCard()).getByText('French')).toBeTruthy();
  expect(language.i18next.language).toBe('fr');
  expect(stored).toBe('fr');
  expect(save()).toBeDisabled();
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
});

it('healthy English read agrees with an explicitly saved English document', async () => {
  await language.changeLanguage('en');
  jest.mocked(chrome.storage.local.set).mockClear();
  render(<Languages />);
  await waitFor(() => expect(trigger().textContent).toContain('English'));
  expect(within(currentCard()).getAllByText('English')).toHaveLength(2);
  expect(language.i18next.language).toBe('en');
  expect(stored).toBe('en');
  expect(save()).toBeDisabled();
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
});

it('does not report English as current when the page read fails in a restored French document', async () => {
  refuseNextRead = true;
  render(<Languages />);
  await act(async () => undefined);
  expect(readCallbacks).toBe(1);
  expect(language.i18next.language).toBe('fr');
  expect(stored).toBe('fr');
  // The product may retain the effective locale or show unavailable state;
  // it must not positively misreport a different successfully saved language.
  expect(within(currentCard()).queryAllByText('English')).toHaveLength(0);
});

it('lets the user explicitly save English after that read refusal', async () => {
  refuseNextRead = true;
  render(<Languages />);
  await act(async () => undefined);
  expect(language.i18next.language).toBe('fr');
  expect(stored).toBe('fr');
  await choose('English English');
  expect(save()).not.toBeDisabled();
  fireEvent.click(save());
  await waitFor(() => expect(stored).toBe('en'));
  expect(language.i18next.language).toBe('en');
});

it('healthy alternate selection remains durable after a page read refusal', async () => {
  refuseNextRead = true;
  render(<Languages />);
  await act(async () => undefined);
  await choose('German Deutsch');
  expect(save()).not.toBeDisabled();
  fireEvent.click(save());
  await waitFor(() => expect(stored).toBe('de'));
  expect(language.i18next.language).toBe('de');
  expect(chrome.storage.local.set).toHaveBeenCalledWith(
    { language: 'de' },
    expect.any(Function)
  );
});

it('reopening after a transient page read refusal restores the actual French preference', async () => {
  refuseNextRead = true;
  const view = render(<Languages />);
  await act(async () => undefined);
  expect(language.i18next.language).toBe('fr');
  view.unmount();
  render(<Languages />);
  await waitFor(() => expect(trigger().textContent).toContain('Français'));
  expect(within(currentCard()).getByText('French')).toBeTruthy();
  expect(save()).toBeDisabled();
  expect(stored).toBe('fr');
  expect(chrome.storage.local.set).not.toHaveBeenCalled();
});

it('preserves the actual French preference on a failed English Save and permits retry', async () => {
  refuseNextRead = true;
  render(<Languages />);
  await act(async () => undefined);
  await choose('English English');
  jest.mocked(chrome.storage.local.set).mockImplementationOnce(((
    _items: unknown,
    callback: () => void
  ) => {
    (chrome.runtime as any).lastError = {
      message: 'Synthetic Chrome storage write unavailable',
    };
    callback();
    delete (chrome.runtime as any).lastError;
  }) as any);
  fireEvent.click(save());
  await screen.findByRole('alert');
  expect(stored).toBe('fr');
  expect(language.i18next.language).toBe('fr');
  expect(save()).not.toBeDisabled();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(save());
  await waitFor(() => expect(stored).toBe('en'));
  expect(language.i18next.language).toBe('en');
  expect(chrome.storage.local.set).toHaveBeenCalledTimes(2);
});

it('keeps an edited draft when a delayed successful initial read finishes', async () => {
  let finishRead!: () => void;
  jest.mocked(chrome.storage.local.get).mockImplementationOnce(((
    _keys: unknown,
    callback: (items: { language: string }) => void
  ) => {
    const snapshot = stored;
    finishRead = () => callback({ language: snapshot });
  }) as any);
  render(<Languages />);
  await choose('German Deutsch');
  await act(async () => finishRead());
  expect(trigger().textContent).toContain('Deutsch');
  expect(within(currentCard()).getByText('French')).toBeTruthy();
  expect(stored).toBe('fr');
  fireEvent.click(save());
  await waitFor(() => expect(stored).toBe('de'));
  expect(language.i18next.language).toBe('de');
});

it('does not let an older initial read replace a completed durable Save', async () => {
  let finishRead!: () => void;
  jest.mocked(chrome.storage.local.get).mockImplementationOnce(((
    _keys: unknown,
    callback: (items: { language: string }) => void
  ) => {
    const snapshot = stored;
    finishRead = () => callback({ language: snapshot });
  }) as any);
  render(<Languages />);
  await choose('German Deutsch');
  fireEvent.click(save());
  await waitFor(() => expect(stored).toBe('de'));
  expect(language.i18next.language).toBe('de');
  await act(async () => finishRead());
  expect(trigger().textContent).toContain('Deutsch');
  expect(within(currentCard()).getByText('German')).toBeTruthy();
  expect(save()).toBeDisabled();
  expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
});
