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

import { formatMethodName } from './commonMethodSignatures';
import { decodeTransactionData } from './ethUtil';
import { getSmartAccountActionErrorMessage } from './smartAccountErrors';
import { getSyscoinPsbtReviewError } from './syscoinPsbtReview';
import {
  translateConfirmationEta,
  translatePsbtReviewError,
  translateTransactionLabel,
  translateTransactionType,
} from './transactionDisplay';

const locales = { en, es, pt, fr, de, zh, ja, ko, ru };
const resources = Object.fromEntries(
  Object.entries(locales).map(([key, value]) => [key, { translation: value }])
);

describe.each(Object.keys(locales))(
  '%s transaction display projection',
  (lng) => {
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
    it('translates known labels and types without changing raw copy/filter identities', () => {
      const raw = Object.freeze({
        label: 'Block Hash',
        value: '0x' + 'ab'.repeat(32),
        type: 'Sent',
      });
      expect(translateTransactionLabel(raw.label, i18n.t)).toBe(
        i18n.t('transactionDisplay.blockHash')
      );
      expect(translateTransactionType(raw.type, i18n.t)).toBe(
        i18n.t('send.sent')
      );
      expect(translateTransactionType('Unknown', i18n.t)).toBe(
        i18n.t('components.unknown')
      );
      expect(translateTransactionType('SYS → SYSX', i18n.t)).toBe('SYS → SYSX');
      expect(raw).toEqual({
        label: 'Block Hash',
        value: '0x' + 'ab'.repeat(32),
        type: 'Sent',
      });
      for (const rawData of [
        'transferFrom(address,address,uint256)',
        'My A&B contract',
        '0x12345678',
        '__proto__',
      ]) {
        expect(translateTransactionLabel(rawData, i18n.t)).toBe(rawData);
        expect(translateTransactionType(rawData, i18n.t)).toBe(rawData);
      }
    });
    it('formats only the known ETA presentation, retaining unknown/invalid input verbatim', () => {
      for (const [raw, key, count] of [
        ['12 sec', 'seconds', 12],
        ['2 min', 'minutes', 2],
        ['1 hr', 'hours', 1],
        ['1 day', 'days', 1],
        ['3 days', 'days', 3],
      ] as const) {
        expect(translateConfirmationEta(raw, i18n.t)).toBe(
          i18n.t(`transactionDisplay.${key}`, { count })
        );
      }
      for (const raw of ['', 'unknown', '-1 sec', '1.2 min'])
        expect(translateConfirmationEta(raw, i18n.t)).toBe(raw);
    });
    it('translates a real failed PSBT review without weakening admission or changing data', () => {
      const decoded = {
        feeSatoshis: '1000',
        syscoin: { txtype: 'unknown_A&B_operation' },
        vout: [],
      };
      const before = JSON.stringify(decoded);
      const error = getSyscoinPsbtReviewError(decoded, {});
      expect(error).toBe(
        'Unsupported Syscoin transaction type: unknown_A&B_operation'
      );
      expect(translatePsbtReviewError(error!, i18n.t)).toBe(
        i18n.t('psbtReview.unsupportedType', {
          type: 'unknown_A&B_operation',
          interpolation: { escapeValue: false },
        })
      );
      expect(translatePsbtReviewError(error!, i18n.t)).toContain(
        'unknown_A&B_operation'
      );
      expect(getSyscoinPsbtReviewError(decoded, {})).toBe(error);
      expect(JSON.stringify(decoded)).toBe(before);
      expect(
        getSyscoinPsbtReviewError(
          { feeSatoshis: '1000', syscoin: { txtype: 'bitcoin' }, vout: [] },
          {}
        )
      ).toBeNull();
      expect(translatePsbtReviewError('provider revert: raw A&B', i18n.t)).toBe(
        'provider revert: raw A&B'
      );
    });
    it('localizes the real creation decoder sentinel without changing decoded data', async () => {
      const decoded = await decodeTransactionData({
        data: '0x60006000',
        to: undefined,
      } as any);
      expect(decoded).toEqual({
        method: 'Contract Deployment',
        types: [],
        inputs: [],
        names: [],
      });
      const raw = JSON.stringify(decoded);
      expect(formatMethodName(decoded.method, 'SYS', i18n.t)).toBe(
        i18n.t('transactions.contractDeploy')
      );
      expect(formatMethodName('Contract Deploy', 'SYS', i18n.t)).toBe(
        i18n.t('transactions.contractDeploy')
      );
      expect(JSON.stringify(decoded)).toBe(raw);
    });
  }
);

it('maps only the explicit local-session code to the supplied translated guidance', () => {
  const raw = Object.assign(new Error('Invalid wallet session'), {
    code: 'PALI_INVALID_WALLET_SESSION',
  });
  expect(
    getSmartAccountActionErrorMessage(raw, 'Sitzung erneut öffnen', 'Gas fehlt')
  ).toBe('Sitzung erneut öffnen');
  expect(raw.message).toBe('Invalid wallet session');
  expect(
    getSmartAccountActionErrorMessage(
      new Error('provider A&B'),
      'fallback',
      'gas'
    )
  ).toBe('provider A&B');
});
