export type SmartAccountFeeQuote = Readonly<{
  executionContextId?: string;
  feePayer: Readonly<{
    address: string;
    id: number;
    type: 'HDAccount' | 'Imported' | 'Ledger' | 'Trezor';
  }>;
  gasUnits: string;
  maximumFeeWei: string;
}>;
