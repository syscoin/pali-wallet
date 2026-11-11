import { OperationAuthentication } from '../core/operationAuthentication.ts';

// The native runtime and its mounted prompt share only this one-shot capability.
// It holds neither the SDK secret nor an authenticated-session grant.
export const nativeOperationAuthentication = new OperationAuthentication();
