import type { EvmFeeEnvelope } from './evmFeeApproval';

/** Browser lifecycle adapter for the existing controller dispatcher, never arbitrary RPC. */
export const SMART_ACCOUNT_CONTROLLER_PORT = 'pali-smart-account-controller';
export const SMART_ACCOUNT_FEE_REVIEW = 'PALI_SMART_ACCOUNT_FEE_REVIEW';
export const SMART_ACCOUNT_FEE_APPROVAL = 'PALI_SMART_ACCOUNT_FEE_APPROVAL';
export const SMART_ACCOUNT_AUTHORIZATION_UPDATED_EVENT =
  'pali-smart-account-authorization-signed';
export type SmartAccountControllerFeeReview = Readonly<{
  coveredFeeUnits?: string;
  id: string;
  maximumFeeUnits: string;
  maximumTotalUnits: string;
  transaction: EvmFeeEnvelope;
  validForMs: number;
}>;
export type SmartAccountControllerCallOptions = Readonly<{
  confirmFee(
    review: SmartAccountControllerFeeReview,
    signal: AbortSignal
  ): Promise<string | null>;
}>;
export const isOwnedSmartAccountControllerCall = (methods: unknown): boolean =>
  Array.isArray(methods) &&
  methods.length === 2 &&
  methods[0] === 'wallet' &&
  [
    'signSmartAccountPreparedOwner',
    'approveSmartAccountExecutionFeeQuote',
    'signSmartAccountCompositeOwner',
    'verifySmartAccountCompositePossession',
    'registerSmartAccountOnChain',
    'submitSmartAccountExecution',
  ].includes(methods[1]);
export type SmartAccountControllerAuthority = Readonly<{
  allowWalletSendPayerBudget?: true;
  assertCurrent(): void;
  confirmFee?(review: SmartAccountControllerFeeReview): Promise<string | null>;
  kind: 'document' | 'worker';
  signal: AbortSignal;
}>;
