export type SmartAccountCancellationPayerBudget = Readonly<{
  gasTank: boolean;
  maximumFeeWei: string;
  maximumPrefundFeeWei: string;
  maximumPrefundWei: string;
}>;

export type SmartAccountFeeQuote = Readonly<{
  cancellationPayerBudget?: SmartAccountCancellationPayerBudget;
  executionContextId?: string;
  feePayer: Readonly<{
    address: string;
    id: number;
    type: 'HDAccount' | 'Imported' | 'Ledger' | 'Trezor';
  }>;
  gasUnits: string;
  maximumFeeWei: string;
}>;

export function matchesSmartAccountCancellationPayerBudget(
  expected: SmartAccountCancellationPayerBudget | undefined,
  approved: SmartAccountCancellationPayerBudget | undefined
): boolean {
  if (!expected || !approved) return expected === approved;
  return (
    expected.gasTank === approved.gasTank &&
    expected.maximumFeeWei === approved.maximumFeeWei &&
    expected.maximumPrefundWei === approved.maximumPrefundWei &&
    expected.maximumPrefundFeeWei === approved.maximumPrefundFeeWei
  );
}
