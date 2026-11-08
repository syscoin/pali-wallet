import {
  normalizeSentryServiceSettings,
  parseSentrySettingsStorageKey,
  readSentryServiceSettings,
  sentrySettingsStorageKey,
} from './sentrySettings';

it('uses the existing network defaults only when the settings record is absent', () => {
  expect(readSentryServiceSettings(undefined, 'mainnet')).toEqual({
    serviceUrl: 'https://sysnode.info',
    maxFeeSatoshis: '100000',
  });
  expect(readSentryServiceSettings(undefined, 'testnet')).toEqual({
    serviceUrl: '',
    maxFeeSatoshis: '100000',
  });
  for (const value of [
    null,
    false,
    0,
    {},
    { serviceUrl: '' },
    { maxFeeSatoshis: '100000' },
  ])
    expect(() => readSentryServiceSettings(value, 'mainnet')).toThrow();
});

it.each([
  'https://sysnode.info/',
  'http://127.0.0.1:8800/',
  'http://localhost:8080',
])('normalizes an existing supported service origin %s', (serviceUrl) => {
  const settings = normalizeSentryServiceSettings({
    serviceUrl,
    maxFeeSatoshis: '10000000',
  });
  expect(settings.serviceUrl).toBe(new URL(serviceUrl).origin);
  expect(settings.maxFeeSatoshis).toBe('10000000');
  expect(Object.isFrozen(settings)).toBe(true);
});

it.each(['0', '-1', '01', '1e5', '1.2', '10000001', ' 1', 'Infinity'])(
  'rejects invalid exact fee limit %s',
  (maxFeeSatoshis) => {
    expect(() =>
      normalizeSentryServiceSettings({
        serviceUrl: 'https://sysnode.info',
        maxFeeSatoshis,
      })
    ).toThrow();
  }
);

it('rejects extra fields and accessors without evaluating them', () => {
  let called = false;
  expect(() =>
    normalizeSentryServiceSettings({
      get serviceUrl() {
        called = true;
        return 'https://sysnode.info';
      },
      maxFeeSatoshis: '1',
    })
  ).toThrow();
  expect(called).toBe(false);
  expect(() =>
    normalizeSentryServiceSettings({
      serviceUrl: 'https://sysnode.info',
      maxFeeSatoshis: '1',
      extra: true,
    })
  ).toThrow();
  expect(() =>
    normalizeSentryServiceSettings({
      serviceUrl: 'https://sysnode.info',
      maxFeeSatoshis: 1,
    })
  ).toThrow();
});

it('keeps the existing wallet/network storage key and parses only that public domain', () => {
  const key = `sentry-settings-v1:${'ab'.repeat(32)}:testnet`;
  expect(sentrySettingsStorageKey('ab'.repeat(32), 'testnet')).toBe(key);
  expect(parseSentrySettingsStorageKey(key)).toEqual({
    vaultId: 'ab'.repeat(32),
    network: 'testnet',
  });
  expect(parseSentrySettingsStorageKey(key + ':extra')).toBeNull();
  expect(
    parseSentrySettingsStorageKey(key.replace(':testnet', ':other'))
  ).toBeNull();
  expect(() => sentrySettingsStorageKey('wrong', 'mainnet')).toThrow();
});
