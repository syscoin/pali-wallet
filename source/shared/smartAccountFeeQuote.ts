export type SmartAccountFeeQuote = Readonly<{
  feePayer: Readonly<{
    address: string;
    id: number;
    type: 'HDAccount' | 'Imported' | 'Ledger' | 'Trezor';
  }>;
  gasUnits: string;
  maximumFeeWei: string;
}>;
