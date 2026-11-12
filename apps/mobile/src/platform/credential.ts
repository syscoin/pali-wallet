/** Browser previews have no OS authorization capability. */
export async function authorizePublicView(_signal: AbortSignal, _assertCurrent: () => void): Promise<void> {
  throw new Error('CREDENTIAL_UNAVAILABLE');
}
export const isNativeCredentialPromptActive = (_owner?: AbortSignal): boolean => false;
export async function getPublicViewAuthorizationStatus(): Promise<'ready' | 'missing' | 'unsupported'> { return 'unsupported'; }
