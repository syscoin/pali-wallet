import {
  assertExtensionVersion,
  expectedExtensionVersion,
} from '../../e2e/harness/extensionVersion';
import packageJson from '../../package.json';
import { extensionBuildVersion } from '../../source/config/extensionBuildVersion.cjs';

const production = extensionBuildVersion('production', packageJson.version);
const canary = extensionBuildVersion('canary', packageJson.version, '42');
const canaryEnvironment = {
  PALI_TEST_DAPP_CHANNEL: 'canary',
  PALI_CANARY_BUILD_NUMBER: '42',
};

it('defaults to the exact production version with no Canary display name', () => {
  expect(assertExtensionVersion(production, {})).toEqual({
    channel: 'production',
    ...production,
  });
  expect(
    assertExtensionVersion(production, { PALI_TEST_DAPP_CHANNEL: 'production' })
  ).toEqual({ channel: 'production', ...production });
  expect(() => assertExtensionVersion(canary, {})).toThrow('does not match');
  expect(() =>
    assertExtensionVersion(
      { ...production, ['version_name']: 'Development' },
      {}
    )
  ).toThrow('does not match');
});

it('requires the exact canonical Canary version and display name for its explicit build number', () => {
  expect(assertExtensionVersion(canary, canaryEnvironment)).toEqual({
    channel: 'canary',
    ...canary,
  });
  for (const manifest of [
    production,
    { ...canary, version: '5.0.0.41' },
    { ...canary, version: '0.0.0.42' },
    { version: canary.version },
    { ...canary, ['version_name']: 'Pali Canary' },
  ])
    expect(() => assertExtensionVersion(manifest, canaryEnvironment)).toThrow(
      'does not match'
    );
});

it.each(['', 'development', 'nightly', 'Canary'])(
  'rejects unknown channel %j',
  (channel) => {
    expect(() =>
      expectedExtensionVersion({ PALI_TEST_DAPP_CHANNEL: channel })
    ).toThrow('Unknown');
  }
);

it.each([undefined, '', '0', '01', '-1', '1.5', '65536'])(
  'requires a valid explicit Canary number: %j',
  (number) => {
    expect(() =>
      expectedExtensionVersion({
        PALI_TEST_DAPP_CHANNEL: 'canary',
        PALI_CANARY_BUILD_NUMBER: number,
      })
    ).toThrow();
  }
);

it.each([null, undefined, '5.0.0', {}, []])(
  'rejects missing version metadata: %j',
  (manifest) => {
    expect(() => assertExtensionVersion(manifest, {})).toThrow();
  }
);
