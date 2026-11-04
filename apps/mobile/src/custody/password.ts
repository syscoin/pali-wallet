import { isStrongWalletPassword } from '../../../../source/shared/passwordPolicy.ts';

/** Native text/storage transport limits; these do not redefine password strength. */
export function isNativePasswordInput(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.isWellFormed() &&
    new TextEncoder().encode(value).length <= 1024;
}

export function isNativeNewPassword(value: unknown): value is string {
  return isNativePasswordInput(value) && isStrongWalletPassword(value);
}

export const NEW_PASSWORD_HELP = 'Use at least 12 characters, including uppercase and lowercase letters, a number and a symbol.';
