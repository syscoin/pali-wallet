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

const translations = { en, de, es, fr, ja, ko, pt, ru, zh };
const quantities = [
  '42',
  '0',
  '115792089237316195423570985008687907853269984665640564039457584007913129639935',
];

describe.each(Object.entries(translations))(
  '%s verified token balance feedback',
  (lng, translation) => {
    const instance = createInstance();
    beforeAll(() =>
      instance.init({
        lng,
        fallbackLng: false,
        resources: { [lng]: { translation } },
        interpolation: { escapeValue: true },
        initImmediate: false,
      })
    );
    it.each(quantities)('renders exact owned ERC1155 quantity %s', (amount) => {
      const message = instance.t('send.youOnlyOwn', { amount });
      expect(message).toContain(amount);
      expect(message).not.toMatch(/\{\{?amount\}?\}/);
      expect(message).not.toContain('e+');
    });
    it.each(quantities)(
      'renders exact verified ERC20 balance %s',
      (balance) => {
        const message = instance.t('send.insufficientFundsVerified', {
          balance,
        });
        expect(message).toContain(balance);
        expect(message).not.toMatch(/\{\{?balance\}?\}/);
        expect(message).not.toContain('e+');
      }
    );
  }
);
