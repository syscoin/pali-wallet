import en from '../../source/assets/locales/en.json';

// Legacy feature fixtures deliberately expose most translation keys. Resolve
// only newly localized display surfaces, retaining each fixture's old fallback
// for every other key and retaining real resource interpolation for identities.
const displayKeys = new Set([
  'generalMenu.languages',
  'faucet.title',
  'components.reconnectForSensitiveInformation',
  'components.walletServiceReconnecting',
  'components.walletViewLoadingSlow',
  'components.loadingWalletView',
  'components.reloadWallet',
  'buttons.report',
  'start.getStarted',
  'start.importWalletSeedPhrase',
  'start.unlockConfirmationFailed',
  'tokens.genericToken',
  'transactions.labelCopied',
  'transactions.decodeDetailsFailed',
  'transactions.transactionOptions',
  'transactions.rbfLabel',
  'components.disabled',
  'components.enabled',
  'transactions.zdagProtectionLabel',
  'transactions.feeRateLabel',
  'transactions.copyDetailsAsJson',
  'transactions.copyDetails',
  'components.type',
  'transactions.outputsHeading',
  'transactions.outputNumber',
  'transactions.recipient',
  'transactions.outputType',
  'transactions.outputScript',
  'transactions.standard',
  'transactions.originContract',
  'transactions.burnAmount',
  'transactions.opReturnData',
  'transactions.bridgeToNevm',
  'transactions.nevmAddress',
  'transactions.bridgeFromNevm',
  'transactions.nevmTxid',
  'transactions.podaHeading',
  'transactions.blobHash',
  'transactions.technicalDetails',
  'transactions.version',
  'transactions.weight',
  'transactions.lockTime',
  'transactions.inputNumber',
  'transactions.output',
  'transactions.sequence',
  'components.connectingWallet',
  'components.connectingWalletSlow',
  'components.unexpectedErrorTitle',
  'components.unexpectedErrorDescription',
  'components.refreshPage',
  'tokens.assetNotFound',
  'nftDetails.information',
  'nftDetails.standard',
  'nftDetails.owned',
  'tokens.contractStatus',
  'tokens.thisToken',
  'home.viewOnNamedExplorer',
  'tokens.sptAsset',
  'tokens.thisSptAsset',
  'nftDetails.viewNamedCollection',
  'nftDetails.deleteNamedCollection',
  'components.noInformation',
  'transactions.symbolTransfer',
  'transactions.contract',
  'transactions.estimatedBlockConfirmation',
  'transactions.zdagConfirmed',
  'transactions.estimatedConfirmation',
  'components.chainWithId',
  'components.estimatedAbbreviation',
  'components.notAvailable',
  'send.from',
  'send.to',
  'send.balance',
  'send.amount',
  'send.transactionId',
  'settings.contractAddress',
  'tokens.viewTokenDetails',
  'tokens.deleteToken',
  'notifications.sptTransfer',
  'notifications.bridgeToNevm',
  'notifications.mintFromNevm',
  'notifications.nevmData',
  'notifications.transaction',
]);

export const localizedUiCopy = (
  key: string,
  values?: Record<string, unknown>
): string | undefined => {
  if (
    !displayKeys.has(key) &&
    !key.startsWith('transactionDisplay.') &&
    !key.startsWith('psbtReview.')
  )
    return undefined;
  const text = key.split('.').reduce((value: any, part) => value?.[part], en);
  if (typeof text !== 'string')
    throw new Error(`Missing English resource: ${key}`);
  return text.replace(/\{\{([^}]+)\}\}/g, (placeholder, name) =>
    values?.[name] === undefined ? placeholder : String(values[name])
  );
};
