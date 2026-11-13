import packageJson from '../../package.json';
import { extensionBuildVersion } from '../../source/config/extensionBuildVersion.cjs';

type VersionEnvironment = Readonly<Record<string, string | undefined>>;

export function expectedExtensionVersion(environment: VersionEnvironment) {
  const channel = environment.PALI_TEST_DAPP_CHANNEL ?? 'production';
  if (channel !== 'production' && channel !== 'canary')
    throw new Error('Unknown extension test channel');
  return {
    channel,
    ...extensionBuildVersion(
      channel,
      packageJson.version,
      environment.PALI_CANARY_BUILD_NUMBER
    ),
  };
}

export function assertExtensionVersion(
  manifest: unknown,
  environment: VersionEnvironment
) {
  const expected = expectedExtensionVersion(environment);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
    throw new Error('Extension artifact version metadata is missing');
  const value = manifest as Record<string, unknown>;
  if (
    value.version !== expected.version ||
    value.version_name !== expected.version_name
  )
    throw new Error(
      'Extension artifact version does not match the requested test channel'
    );
  return expected;
}

/** Exact public provider identity for the already selected artifact channel. */
export function expectedProviderIdentity(environment: VersionEnvironment) {
  const canary = expectedExtensionVersion(environment).channel === 'canary';
  return Object.freeze({
    name: canary ? 'Pali Wallet Canary' : 'Pali Wallet',
    rdns: canary ? 'com.paliwallet.canary' : 'com.paliwallet',
    notificationEvent: canary
      ? 'pali-canary:paliNotification'
      : 'paliNotification',
    stateKey: canary ? 'pali-canary:paliProvider' : 'paliProvider',
    sysProviderKey: canary ? 'paliCanary' : 'pali',
  });
}
