import type { NativePrivateAuthenticationScope } from '../custody/privateAuthentication';

/** Keep only this owner's pending OS proof alive; delivery still requires foreground. */
export function allowsPrivateAuthenticationInterruption(scope: NativePrivateAuthenticationScope, state: string | null | undefined): boolean {
  return (state === 'inactive' || state === 'blur') && scope.isAuthenticating();
}
