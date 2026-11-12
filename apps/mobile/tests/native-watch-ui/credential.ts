/** Browser rendering fixture; production uses the platform's OS authorization. */
export async function authorizePublicView(signal: AbortSignal, check: () => void) {
  if (signal.aborted) throw Error('CANCELLED');
  check(); await Promise.resolve(); check();
}
export const isNativeCredentialPromptActive = () => false;
export const getPublicViewAuthorizationStatus = async () => 'ready' as const;
