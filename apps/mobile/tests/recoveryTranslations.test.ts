import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstance } from 'i18next';
import { languageMessages } from './localizationFixture.ts';
import { recoveryErrorText, recoveryOutcomeText } from '../src/screens/recoveryCopy.ts';

const consent = [
  'mobile.settings.watchBody', 'mobile.resetActivity.description', 'mobile.resetActivity.pendingBody',
  'mobile.security.phraseRestore', 'mobile.security.extendedBody', 'mobile.accounts.removeImported',
  'mobile.accounts.backupAcknowledgement', 'mobile.importAccount.separateBody',
  'mobile.importAccount.backupAcknowledgement',
];
const codes = ['SAVED_WALLET_UNVERIFIED', 'WRONG_PHRASE', 'AUTH_THROTTLED', 'INVALID_INPUT', 'INVALID_WORD_COUNT', 'REOPEN_REQUIRED'] as const;
for (const language of ['de', 'fr', 'es', 'pt', 'ja', 'ko', 'ru', 'zh']) {
  test(`${language} recovery and security consent resolve without English fallback`, async () => {
    const i18n = createInstance(), en = createInstance();
    await Promise.all([i18n.init({ initImmediate: false, lng: language, fallbackLng: false,
      resources: { [language]: { translation: languageMessages(language) } } }),
    en.init({ initImmediate: false, lng: 'en', fallbackLng: false, resources: { en: { translation: languageMessages('en') } } })]);
    const t = (key: string) => i18n.t(key), english = (key: string) => en.t(key);
    for (const key of consent) {
      assert(i18n.exists(key), key); assert.notEqual(t(key), key); assert.notEqual(t(key), english(key), key);
    }
    for (const code of codes) {
      assert(recoveryErrorText(code, t));
      assert.notEqual(recoveryErrorText(code, t), recoveryErrorText(code, english), code);
      assert(!recoveryErrorText(code, t).startsWith('mobile.'));
    }
    for (const kind of ['success', 'cancelled', 'expired', 'failed', 'uncertain'] as const) {
      const outcome = { kind, operationPhase: 'commit' as const, code: 'UNAVAILABLE' };
      assert(recoveryOutcomeText(outcome, t));
      assert.notEqual(recoveryOutcomeText(outcome, t), recoveryOutcomeText(outcome, english), kind);
    }
  });
}
