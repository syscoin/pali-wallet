/** Store identities are shipped with the app, never supplied by release metadata. */
export const PALI_STORES = Object.freeze({
  chrome:
    'https://chromewebstore.google.com/detail/pali-wallet/mgffkfbidihjpoaomajlbgchddlicgpn',
  android:
    'https://play.google.com/store/apps/details?id=com.paliwallet.mobile',
  // Set the assigned numeric App Store ID when the first iOS listing is created.
  ios: null as string | null,
});
