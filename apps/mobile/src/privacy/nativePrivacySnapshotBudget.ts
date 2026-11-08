// Native transports independently enforce the same response ceiling. The
// transport contract test checks both compiled-platform source constants.
export const NATIVE_PRIVACY_SNAPSHOT_BYTES = 16 * 1024 * 1024;
export const NATIVE_PRIVACY_RUN_BYTES =
  NATIVE_PRIVACY_SNAPSHOT_BYTES + 4 * 1024 * 1024;
