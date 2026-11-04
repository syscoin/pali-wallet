/** Existing extension password policy, shared without normalization or Unicode changes. */
export const WALLET_PASSWORD_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/;

export function isStrongWalletPassword(value: unknown): value is string {
  return typeof value === 'string' && WALLET_PASSWORD_PATTERN.test(value);
}
