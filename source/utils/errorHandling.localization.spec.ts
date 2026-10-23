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

import { handleTransactionError, isBlacklistError } from './errorHandling';
import { sanitizeErrorMessage } from './syscoinErrorSanitizer';

jest.mock('utils/index', () => ({ truncate: (text: string) => text }));

const resources = Object.fromEntries(
  Object.entries({ en, es, pt, fr, de, zh, ja, ko, ru }).map(
    ([lng, translation]) => [lng, { translation }]
  )
);
describe.each(Object.keys(resources))(
  '%s transaction error presentation',
  (lng) => {
    const i18n = createInstance();
    beforeAll(() =>
      i18n.init({
        resources,
        lng,
        initImmediate: false,
        fallbackLng: false,
        interpolation: { escapeValue: true },
      })
    );
    it('localizes the local recipient refusal while retaining classifier, raw reason and severity', () => {
      const error = Object.assign(
        new Error('Token transfer blocked: provider A&B. Severity: high.'),
        {
          code: 'PALI_TOKEN_RECIPIENT_BLOCKED',
          recipientBlockReason: 'provider A&B',
          recipientBlockSeverity: 'high',
        }
      );
      const raw = error.message;
      const alert = { error: jest.fn() };
      expect(isBlacklistError(error)).toBe(true);
      expect(handleTransactionError(error, alert, i18n.t)).toBe(true);
      expect(alert.error).toHaveBeenCalledWith(
        i18n.t('blacklist.tokenRecipientBlocked', {
          reason: 'provider A&B',
          severity: 'high',
          interpolation: { escapeValue: false },
        })
      );
      expect(alert.error.mock.calls[0][0]).toContain('provider A&B');
      expect(error.message).toBe(raw);
      expect(isBlacklistError(error)).toBe(true);
    });
    it('keeps unrelated external blacklist text and codes intact', () => {
      const error = Object.assign(
        new Error('Transaction blocked: provider A&B'),
        { code: 4001 }
      );
      const alert = { error: jest.fn(), info: jest.fn() };
      expect(handleTransactionError(error, alert, i18n.t)).toBe(true);
      expect(alert.error).toHaveBeenCalledWith(error.message);
      expect(alert.info).not.toHaveBeenCalled();
      expect(error.code).toBe(4001);
    });
    it('adds no extra interpolation-escaping pass to real structured broadcast details', () => {
      const error = {
        error: true,
        code: 'TRANSACTION_SEND_FAILED',
        message: 'Details: {"error":"provider A&B"}',
      };
      const before = JSON.stringify(error);
      const alert = { error: jest.fn() };
      expect(
        handleTransactionError(
          error,
          alert,
          i18n.t,
          undefined,
          { currency: 'SYS' },
          undefined,
          sanitizeErrorMessage
        )
      ).toBe(true);
      const inner = i18n.t('send.transactionFailureDetails', {
        message: 'provider A&B',
        interpolation: { escapeValue: false },
      });
      expect(alert.error).toHaveBeenCalledWith(
        i18n.t('send.transactionSendFailed', { message: inner })
      );
      expect(alert.error.mock.calls[0][0]).toContain('A&amp;B');
      expect(alert.error.mock.calls[0][0]).not.toContain('A&amp;amp;B');
      expect(JSON.stringify(error)).toBe(before);
    });
    it('retains the raw code and sanitizer output in the localized creation wrapper', () => {
      const error = {
        error: true,
        code: 'TRANSACTION_CREATION_FAILED',
        message: 'provider A&B',
      };
      const alert = { error: jest.fn() };
      expect(
        handleTransactionError(error, alert, i18n.t, undefined, {
          currency: 'SYS',
        })
      ).toBe(true);
      expect(alert.error).toHaveBeenCalledWith(
        i18n.t('send.transactionCreationFailureDetails', {
          code: error.code,
          message: error.message,
          interpolation: { escapeValue: false },
        })
      );
      expect(alert.error.mock.calls[0][0]).toContain('provider A&B');
    });
  }
);
