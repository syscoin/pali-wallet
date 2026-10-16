import { ITransactionInfoUtxo } from 'types/useTransactionsInfo';

// Account fields captured from both public readers. Status fields are synthetic;
// addresses and account identifiers are omitted because these rows need neither.
const confirmedCompactRow = {
  blockHeight: 1,
  blockTime: 1700000000,
  confirmations: 1,
  direction: 'sent',
  tokenType: 'SPTAssetAllocationBurnToNEVM',
  vin: [],
  vout: [],
};

export const compactBridgeNativeOffset = {
  ...confirmedCompactRow,
  txid: '984d835e875964bc939b572eaaa88568dbaad7323c8f28082c4d552f8f444aa9',
  addressValueIn: '2959851940',
  addressValueOut: '0',
  fees: '2260',
} as ITransactionInfoUtxo;

export const compactBridgeWithAccountAsset = {
  ...confirmedCompactRow,
  txid: '2666e1fda0008c89674b1560665a2ba948b3e8371d1058a8dae83e2004818d85',
  addressValueIn: '2959883900',
  addressValueOut: '2959882030',
  fees: '1870',
  accountAssetTransfers: [
    {
      type: 'SPT',
      standard: 'SPT',
      from: '',
      to: '',
      contract: '123456',
      symbol: 'SYSX',
      decimals: 8,
      value: '10000000',
      assetGuid: '123456',
    },
  ],
} as ITransactionInfoUtxo;
