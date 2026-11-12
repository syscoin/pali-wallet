import {
  admitExtensionReleaseTarget,
  CANARY_EXTENSION_ID,
  CANARY_EXTENSION_FEED_URL,
  CANARY_EXTENSION_STORE_URL,
  CANARY_STORE_EXTENSION_ID,
  CHROME_STORE_UPDATE_URL,
  getExtensionReleaseTarget,
  STABLE_EXTENSION_FEED_URL,
  STABLE_EXTENSION_ID,
  STABLE_EXTENSION_STORE_URL,
} from './extensionReleaseChannel';

// eslint-disable-next-line camelcase -- Chrome defines this manifest field.
const manifest = { version: '5.0.0', update_url: CHROME_STORE_UPDATE_URL };
const info = {
  id: STABLE_EXTENSION_ID,
  version: '5.0.0',
  type: 'extension',
  enabled: true,
  installType: 'normal',
  updateUrl: CHROME_STORE_UPDATE_URL,
};

it('keeps fixed build, feed and store identities distinct', () => {
  expect(STABLE_EXTENSION_ID).not.toBe(CANARY_EXTENSION_ID);
  expect(STABLE_EXTENSION_FEED_URL).not.toBe(CANARY_EXTENSION_FEED_URL);
  expect(getExtensionReleaseTarget(STABLE_EXTENSION_ID)).toEqual({
    channel: 'stable',
    feedUrl: STABLE_EXTENSION_FEED_URL,
    storeUrl: STABLE_EXTENSION_STORE_URL,
  });
  expect(CANARY_STORE_EXTENSION_ID).toBeNull();
  expect(CANARY_EXTENSION_STORE_URL).toBeNull();
  expect(getExtensionReleaseTarget(CANARY_EXTENSION_ID)).toBeNull();
});

it('requires a verified installation rather than a copied manifest key or update URL', () => {
  expect(
    admitExtensionReleaseTarget(STABLE_EXTENSION_ID, manifest, info)?.channel
  ).toBe('stable');
  expect(
    admitExtensionReleaseTarget(STABLE_EXTENSION_ID, { version: '5.0.0' }, info)
      ?.channel
  ).toBe('stable');
  for (const patch of [
    { installType: 'development' },
    { installType: 'admin' },
    { enabled: false },
    { type: 'theme' },
    { id: CANARY_EXTENSION_ID },
    { version: '5.0.1' },
    { updateUrl: undefined },
    { updateUrl: CHROME_STORE_UPDATE_URL + '?x=1' },
  ])
    expect(
      admitExtensionReleaseTarget(STABLE_EXTENSION_ID, manifest, {
        ...info,
        ...patch,
      })
    ).toBeNull();
  expect(
    admitExtensionReleaseTarget(
      STABLE_EXTENSION_ID,
      // eslint-disable-next-line camelcase -- Chrome defines this manifest field.
      { ...manifest, update_url: 'https://untrusted.example' },
      info
    )
  ).toBeNull();
  expect(
    admitExtensionReleaseTarget(CANARY_EXTENSION_ID, manifest, {
      ...info,
      id: CANARY_EXTENSION_ID,
    })
  ).toBeNull();
  expect(admitExtensionReleaseTarget('unknown', manifest, info)).toBeNull();
  expect(
    admitExtensionReleaseTarget(STABLE_EXTENSION_ID, manifest, null)
  ).toBeNull();
});
