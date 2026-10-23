import { createInstance } from 'i18next';

import de from 'assets/locales/de.json';
import en from 'assets/locales/en.json';
import es from 'assets/locales/es.json';
import fr from 'assets/locales/fr.json';
import ja from 'assets/locales/ja.json';
import ko from 'assets/locales/ko.json';
import pt from 'assets/locales/pt.json';
import ru from 'assets/locales/ru.json';
import zh from 'assets/locales/zh.json';

import { translateApprovalGuidance } from './approvalClient';

const locales = { en, es, pt, fr, de, zh, ja, ko, ru };
const resources = Object.fromEntries(
  Object.entries(locales).map(([key, value]) => [key, { translation: value }])
);
const guidance = [
  [
    'This approval has expired. Close this window and request it again.',
    'app.approvalExpired',
  ],
  [
    'Could not read this approval. Close this window and request it again.',
    'app.approvalReadFailed',
  ],
  ['Approval connection cancelled.', 'app.approvalCancelled'],
  [
    'Approval connection timed out. Retry or close this window and request it again.',
    'app.approvalTimedOut',
  ],
  [
    'This approval is no longer available. Close this window and request it again.',
    'app.approvalUnavailable',
  ],
  [
    'Could not connect this approval. Retry or close this window.',
    'app.approvalConnectionFailed',
  ],
] as const;

describe.each(Object.keys(locales))('%s approval guidance', (lng) => {
  const i18n = createInstance();
  beforeAll(() =>
    i18n.init({
      lng,
      resources,
      initImmediate: false,
      fallbackLng: false,
      interpolation: { escapeValue: true },
    })
  );
  it.each(guidance)('projects only the known message %s', (message, key) => {
    const error = Object.assign(new Error(message), {
      code: 'synthetic-handshake-error',
    });
    const translated = translateApprovalGuidance(error.message, i18n.t);
    expect(i18n.exists(key)).toBe(true);
    expect(translated).toBe(i18n.t(key));
    expect(translated).not.toBe(key);
    expect(error.message).toBe(message);
    expect(error.code).toBe('synthetic-handshake-error');
    if (lng === 'en') expect(translated).toBe(message);
    else expect(translated).not.toBe(message);
  });
  it('preserves unknown, similar and prototype-named diagnostics verbatim', () => {
    for (const message of [
      '',
      '__proto__',
      'constructor',
      'provider A&B {{message}}',
      'Approval connection timed out. provider-specific detail',
      'This approval has expired. Close this window and request it again. extra',
    ]) {
      expect(translateApprovalGuidance(message, i18n.t)).toBe(message);
    }
  });
});

it('projects the same raw error using the current language, without storing a translation', async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    resources,
    initImmediate: false,
    fallbackLng: false,
  });
  const [message, key] = guidance[0];
  const error = new Error(message);
  expect(translateApprovalGuidance(error.message, i18n.t)).toBe(message);
  await i18n.changeLanguage('de');
  expect(translateApprovalGuidance(error.message, i18n.t)).toBe(i18n.t(key));
  expect(translateApprovalGuidance(error.message, i18n.t)).not.toBe(message);
  expect(error.message).toBe(message);
});
