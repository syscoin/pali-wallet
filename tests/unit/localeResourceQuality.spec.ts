import fs from 'fs';
import path from 'path';

const languages = ['en', 'es', 'pt', 'fr', 'de', 'zh', 'ja', 'ko', 'ru'];
const resources = Object.fromEntries(
  languages.map((lng) => [
    lng,
    JSON.parse(
      fs.readFileSync(
        path.resolve(__dirname, '../../source/assets/locales', `${lng}.json`),
        'utf8'
      )
    ),
  ])
);
const flatten = (
  object: Record<string, any>,
  prefix = ''
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(object).flatMap(([key, value]) =>
      typeof value === 'string'
        ? [[prefix + key, value]]
        : Object.entries(flatten(value, prefix + key + '.'))
    )
  );
const flat = Object.fromEntries(
  languages.map((lng) => [lng, flatten(resources[lng])])
);

// Algorithm/standard/unit names, not English placeholder guidance. A loanword
// shared with English in one language is valid; this catches all-eight copies.
const identicalTechnicalNames = {
  'transactionDisplay.nonce': 'Nonce',
  'send.batchId': 'ID',
  'tokens.assetGuid': 'GUID',
  'transactions.methodNames.uri': 'URI',
  'sentry.sLHDSASHAKE128sSentryPQ': 'SLH-DSA SHAKE-128s (Sentry PQ)',
  'sentry.satoshis': 'satoshis',
  'sentry.legacyBLS': 'BLS (Basic)',
  'sentry.secp256k1': 'secp256k1',
  'sentry.sLHDSASHAKE128s': 'SLH-DSA SHAKE-128s',
};

it('has no unexplained whole-English placeholders copied into every non-English resource', () => {
  const identical = Object.fromEntries(
    Object.entries(flat.en).filter(
      ([key, value]) =>
        /[A-Za-z]{2}/.test(value) &&
        languages.slice(1).every((lng) => flat[lng][key] === value)
    )
  );
  expect(identical).toEqual(identicalTechnicalNames);
});

it.each(languages.slice(1))(
  '%s has identical keys and interpolation fields, without empty guidance',
  (lng) => {
    expect(Object.keys(flat[lng])).toEqual(Object.keys(flat.en));
    for (const [key, english] of Object.entries(flat.en)) {
      const translated = flat[lng][key];
      expect(translated.trim()).not.toBe('');
      const fields = (value: string) =>
        [...value.matchAll(/{{(.*?)}}/g)].map((match) => match[1]).sort();
      expect(fields(translated)).toEqual(fields(english));
    }
  }
);
