export const SMART_ACCOUNT_PAYER_BUDGET_EXCEEDED =
  'PALI_SMART_ACCOUNT_PAYER_BUDGET_EXCEEDED';

export type SmartAccountFeeOverrides = {
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
};

export type SmartAccountPayerBudget = Readonly<{
  gasTank: boolean;
  maximumFeeWei: string;
  maximumPrefundFeeWei: string;
  maximumPrefundWei: string;
}>;

export type SmartAccountFeeQuote = Readonly<{
  cancellationPayerBudget?: SmartAccountPayerBudget;
  executionContextId?: string;
  feePayer: Readonly<{
    address: string;
    id: number;
    type: 'HDAccount' | 'Imported' | 'Ledger' | 'Trezor';
  }>;
  gasUnits: string;
  maximumFeeWei: string;
  payerBudget?: SmartAccountPayerBudget;
}>;

export function matchesSmartAccountPayerBudget(
  expected: SmartAccountPayerBudget | undefined,
  approved: SmartAccountPayerBudget | undefined
): boolean {
  if (!expected || !approved) return expected === approved;
  return (
    expected.gasTank === approved.gasTank &&
    expected.maximumFeeWei === approved.maximumFeeWei &&
    expected.maximumPrefundWei === approved.maximumPrefundWei &&
    expected.maximumPrefundFeeWei === approved.maximumPrefundFeeWei
  );
}
