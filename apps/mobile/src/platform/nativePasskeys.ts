import type { NativePasskeyCapability } from '../smartAccount/passkeys.ts';
export const isNativePasskeyPromptActive = (_owner?: AbortSignal): boolean => false;
export const createNativePasskeyCapability = (): NativePasskeyCapability | null => null;
