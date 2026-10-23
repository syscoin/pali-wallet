import type { TFunction } from 'i18next';

// Display projections only. The original labels remain the filter, copy-risk,
// sorting and protocol discriminators; unknown ABI/provider data stays intact.
const labels: Record<string, string> = {
  Txid: 'send.transactionId',
  Hash: 'send.transactionId',
  From: 'send.from',
  To: 'send.to',
  'Gas Limit': 'send.gasLimit',
  'Gas Price': 'send.gasPrice',
  Method: 'send.method',
  Success: 'buttons.success',
  Symbol: 'settings.symbol',
  Decimals: 'settings.decimals',
  'Contract Address': 'settings.contractAddress',
  Balance: 'send.balance',
  'Block Hash': 'transactionDisplay.blockHash',
  Confirmations: 'transactionDisplay.confirmations',
  'Estimated Confirmation': 'transactionDisplay.estimatedConfirmation',
  'Block Time': 'transactionDisplay.blockTime',
  Fees: 'transactionDisplay.fees',
  'Block Number': 'transactionDisplay.blockNumber',
  Timestamp: 'transactionDisplay.timestamp',
  'Gas Used': 'transactionDisplay.gasUsed',
  'Max Fee Per Gas': 'transactionDisplay.maxFeePerGas',
  'Max Priority Fee Per Gas': 'transactionDisplay.maxPriorityFeePerGas',
  Nonce: 'transactionDisplay.nonce',
  'Revert Reason': 'transactionDisplay.revertReason',
  Input: 'transactionDisplay.input',
  'Asset Guid': 'transactionDisplay.assetGuid',
  'Transaction Type': 'transactionDisplay.transactionType',
  'Total Sent': 'transactionDisplay.totalSent',
  'Total Received': 'transactionDisplay.totalReceived',
  Contract: 'transactionDisplay.contract',
  'Meta Data': 'transactionDisplay.metadata',
};

const types: Record<string, string> = {
  Unknown: 'components.unknown',
  Sent: 'send.sent',
  Received: 'send.received',
  Send: 'buttons.send',
  'SPT Transfer': 'notifications.sptTransfer',
  'Bridge to NEVM': 'notifications.bridgeToNevm',
  'Mint from NEVM': 'notifications.mintFromNevm',
  'NEVM Data': 'notifications.nevmData',
  Transaction: 'notifications.transaction',
  'Standard Transaction': 'transactionDisplay.standardTransaction',
  'NFT Transfer': 'transactionDisplay.nftTransfer',
  'Token Transfer': 'transactionDisplay.tokenTransfer',
  'Contract Interaction': 'transactionDisplay.contractInteraction',
};

export const translateTransactionLabel = (
  label: string,
  t: TFunction
): string =>
  Object.prototype.hasOwnProperty.call(labels, label)
    ? t(labels[label])
    : label;

export const translateTransactionType = (type: string, t: TFunction): string =>
  Object.prototype.hasOwnProperty.call(types, type) ? t(types[type]) : type;

export const translateConfirmationEta = (eta: string, t: TFunction): string => {
  const match = /^(\d+) (sec|min|hr|days?)$/.exec(eta);
  if (!match) return eta;
  const unit = {
    sec: 'seconds',
    min: 'minutes',
    hr: 'hours',
    day: 'days',
    days: 'days',
  }[match[2]];
  return t(`transactionDisplay.${unit}`, { count: Number(match[1]) });
};

const reviewErrors: Array<[RegExp, string, string[]?]> = [
  [/^Transaction details are not available$/, 'detailsUnavailable'],
  [/^Unable to verify the Sentry operation and network fee$/, 'sentryFee'],
  [/^Unsupported Syscoin transaction type: (.+)$/, 'unsupportedType', ['type']],
  [/^Unable to verify the transaction fee$/, 'fee'],
  [/^Sentry network fees cannot transfer assets$/, 'sentryAssets'],
  [/^Unable to verify Syscoin asset allocations$/, 'allocations'],
  [/^Unable to verify output (\d+) script$/, 'outputScript', ['output']],
  [/^Unable to verify asset GUID (.+)$/, 'assetGuid', ['asset']],
  [/^Unable to verify decimals for asset (.+)$/, 'decimals', ['asset']],
  [
    /^Unable to verify the origin type for asset (.+)$/,
    'originType',
    ['asset'],
  ],
  [/^SYSX metadata does not match its canonical identity$/, 'sysxIdentity'],
  [
    /^ERC20 asset (.+) must use an eight-decimal UTXO representation$/,
    'erc20Decimals',
    ['asset'],
  ],
  [
    /^Unable to verify origin decimals for asset (.+)$/,
    'originDecimals',
    ['asset'],
  ],
  [
    /^Unable to verify origin contract for asset (.+)$/,
    'originContract',
    ['asset'],
  ],
  [/^NFT asset (.+) must use zero-decimal units$/, 'nftDecimals', ['asset']],
  [/^Unable to verify token ID for asset (.+)$/, 'tokenId', ['asset']],
  [/^Asset (.+) has no decoded outputs$/, 'noOutputs', ['asset']],
  [/^Asset (.+) has an invalid output amount$/, 'outputAmount', ['asset']],
  [/^Asset (.+) references a missing output$/, 'missingOutput', ['asset']],
  [
    /^Burn amount for asset (.+) is not representable with (\d+) origin decimals$/,
    'burnDecimals',
    ['asset', 'decimals'],
  ],
  [
    /^Burn amount for asset (.+) is not bound to the burn output$/,
    'burnOutput',
    ['asset'],
  ],
];

export const translatePsbtReviewError = (
  error: string,
  t: TFunction
): string => {
  for (const [pattern, key, fields = []] of reviewErrors) {
    const match = pattern.exec(error);
    if (match)
      return t(`psbtReview.${key}`, {
        ...Object.fromEntries(
          fields.map((field, index) => [field, match[index + 1]])
        ),
        interpolation: { escapeValue: false },
      });
  }
  return error;
};
