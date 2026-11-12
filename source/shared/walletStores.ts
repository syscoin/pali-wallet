import { STABLE_EXTENSION_STORE_URL } from './extensionReleaseChannel.ts';

/** Store identities are shipped with the app, never supplied by release metadata. */
export const PALI_STORES = Object.freeze({
  chrome: STABLE_EXTENSION_STORE_URL,
  android:
    'https://play.google.com/store/apps/details?id=com.paliwallet.mobile',
  ios: 'https://apps.apple.com/app/id6834040718' as string | null,
});
