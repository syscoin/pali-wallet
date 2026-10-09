/** Keep vault ciphertext, permission records and wallet state out of content scripts. */
export const restrictStorageAccess = async () => {
  // Chrome supports this API from version 102 (our minimum is 109). Other
  // browser builds may not expose it; their storage isolation differs.
  if (typeof chrome.storage.local.setAccessLevel === 'function') {
    await chrome.storage.local.setAccessLevel({
      accessLevel: 'TRUSTED_CONTEXTS' as chrome.storage.AccessLevel,
    });
  }
};
