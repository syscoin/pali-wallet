import type { NativePrivateAuthenticationScope } from '../custody/privateAuthentication';

/** The native adapter admits background only for its exact Android credential prompt.
 * A general background state never produces an active marker; delivery requires foreground. */
export function allowsPrivateAuthenticationInterruption(scope: Pick<NativePrivateAuthenticationScope, 'isAuthenticating'>, state: string | null | undefined): boolean {
  return (state === 'inactive' || state === 'blur' || state === 'background') && scope.isAuthenticating();
}
