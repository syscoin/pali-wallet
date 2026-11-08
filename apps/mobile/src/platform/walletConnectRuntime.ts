/** Native external connections require the native platform implementation. */
export async function prepareWalletConnectRuntime(): Promise<void> {
  throw new Error('NATIVE_CONNECTION_UNAVAILABLE');
}
