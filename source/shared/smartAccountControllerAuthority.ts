/** Browser lifecycle adapter for the existing controller dispatcher, never arbitrary RPC. */
export const SMART_ACCOUNT_CONTROLLER_PORT = 'pali-smart-account-controller';
export const isOwnedSmartAccountControllerCall = (methods: unknown): boolean =>
  Array.isArray(methods) &&
  methods.length === 2 &&
  methods[0] === 'wallet' &&
  [
    'signSmartAccountPreparedOwner',
    'registerSmartAccountOnChain',
    'submitSmartAccountExecution',
  ].includes(methods[1]);
export type SmartAccountControllerAuthority = Readonly<{
  assertCurrent(): void;
  kind: 'document' | 'worker';
  signal: AbortSignal;
}>;
