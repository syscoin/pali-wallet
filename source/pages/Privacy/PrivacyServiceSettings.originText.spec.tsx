/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import en from 'assets/locales/en.json';
import { i18next } from 'utils/i18n';
import * as service from 'utils/privacy/service';

import PrivacyServiceSettings from './PrivacyServiceSettings';

const mockEmitter = jest.fn();
jest.mock('hooks/useController', () => ({
  useController: () => ({ controllerEmitter: mockEmitter }),
}));
jest.mock('utils/storageAPI', () => ({
  chromeStorage: {
    getItem: jest.fn().mockResolvedValue('en'),
    setItem: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('components/Button', () => ({
  Button: ({ children, fullWidth, loading, variant, ...props }: any) => (
    <button
      {...props}
      data-full-width={fullWidth}
      aria-busy={loading || undefined}
      data-variant={variant}
    >
      {children}
    </button>
  ),
}));

beforeEach(async () => {
  await waitFor(() => expect(i18next.isInitialized).toBe(true));
  await i18next.changeLanguage('en');
  mockEmitter.mockReset();
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderConflict(current: string) {
  let reads = 0;
  mockEmitter.mockImplementation(async ([, method]: string[]) => {
    if (method === 'getServiceOrigin')
      return ++reads === 1 ? 'https://before.synthetic.invalid' : current;
    throw new Error('privacy_service_changed');
  });
  render(<PrivacyServiceSettings onSettled={jest.fn()} />);
  fireEvent.click(screen.getByText(en.privacy.serviceSettings));
  const input = await screen.findByLabelText(en.privacy.serviceOrigin);
  await waitFor(() =>
    expect(input).toHaveValue('https://before.synthetic.invalid')
  );
  fireEvent.change(input, { target: { value: 'http://127.0.0.1:28803' } });
  fireEvent.click(screen.getByRole('button', { name: en.buttons.save }));
  return screen.findByRole('alert');
}

it.each([
  'http://127.0.0.1:28802',
  'https://service.synthetic.invalid',
  `https://${'w'.repeat(63)}.example`,
])(
  'shows the literal current origin %s with real i18next defaults',
  async (origin) => {
    const alert = await renderConflict(origin);
    expect(alert.textContent).toBe(
      en.privacy.serviceConflict.replace('{{origin}}', origin)
    );
    expect(alert.textContent).not.toContain('&#x2F;');
    expect(alert).toHaveClass('break-words');
    expect(i18next.options.interpolation?.escapeValue).toBe(true);
  }
);

it('renders hostile markup as text without creating elements', async () => {
  // The real URL normalizer rejects markup. This injection tests the renderer's
  // defensive boundary, not an attacker-reachable service origin.
  const hostile = '<img src=x onerror="window.__serviceProbe=true"> & "quotes"';
  const original = service.normalizePrivacyServiceOrigin;
  jest
    .spyOn(service, 'normalizePrivacyServiceOrigin')
    .mockImplementation((value) =>
      value === hostile ? value : original(value)
    );
  const alert = await renderConflict(hostile);
  expect(alert.textContent).toBe(
    en.privacy.serviceConflict.replace('{{origin}}', hostile)
  );
  expect(alert.innerHTML).toContain('&lt;img');
  expect(alert.innerHTML).toContain('&amp;');
  expect(alert.querySelector('img')).toBeNull();
  expect(alert.querySelector('script')).toBeNull();
  expect((window as any).__serviceProbe).toBeUndefined();
  expect(i18next.options.interpolation?.escapeValue).toBe(true);
});

it('keeps default escaping enabled outside this one call', () => {
  const DefaultText = () => {
    const { t } = useTranslation();
    return <p>{t('privacy.serviceConflict', { origin: '<img src=x>' })}</p>;
  };
  const { container } = render(<DefaultText />);
  expect(container.textContent).toContain('&lt;img src=x&gt;');
  expect(container.querySelector('img')).toBeNull();
  expect(i18next.options.interpolation?.escapeValue).toBe(true);
});
