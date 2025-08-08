import {
  WarningOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DownOutlined,
  RightOutlined,
} from '@ant-design/icons';
import { Typography } from 'antd';
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Tooltip, IconButton, Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectActiveAccountAssets } from 'state/vault/selectors';
import { ellipsis } from 'utils/format';
import { formatSyscoinValue } from 'utils/formatSyscoinValue';
import { getSyscoinTransactionTypeLabel } from 'utils/syscoinTransactionUtils';

export interface IDecodedTransaction {
  error?: string;
  fee?: number;
  locktime?: number;
  size?: number;
  syscoin?: {
    allocations?: {
      assets?: Array<{
        assetGuid: string;
        values?: Array<{
          n: number;
          value: number;
          valueFormatted?: string;
        }>;
      }>;
    };
    burn?: {
      ethaddress: string;
    };
    mint?: {
      blockhash: string;
      ethtxid: string;
      receiptpos?: number;
      txpos?: number;
    };
    poda?: {
      blobData?: string;
      blobHash: string;
    };
    txtype?: string;
  };
  txid?: string;
  version?: number;
  vin?: Array<{
    scriptSig: {
      hex: string;
    };
    sequence: number;
    txid: string;
    txinwitness?: string[];
    vout: number;
  }>;
  vout?: Array<{
    n: number;
    scriptPubKey: {
      addresses?: string[];
      hex: string;
      reqSigs?: number;
      type: string;
    };
    value: number;
  }>;
  vsize?: number;
  weight?: number;
}

interface ISyscoinTransactionDetailsProps {
  psbt?: string;
  showTechnicalDetails?: boolean;
  showTransactionOptions?: boolean;
  transaction?: any;
}

// Helper function to convert technical tx type to user-friendly text
export const getTransactionTypeText = (txtype: string): string => {
  // Use the unified normalization function
  const label = getSyscoinTransactionTypeLabel(txtype);

  // Special handling for bitcoin/standard transactions
  if (txtype === 'bitcoin') {
    return 'Standard Transaction';
  }

  // If it's a known SPT transaction type, return the label
  if (label !== 'Transaction') {
    return label;
  }

  // Otherwise return the original txtype or 'Unknown'
  return txtype || 'Unknown';
};

// Component for copyable fields
const CopyableField: React.FC<{
  className?: string;
  copyMessage?: string;
  displayValue?: string;
  label: string;
  labelClassName?: string;
  monospace?: boolean;
  value: string;
  valueClassName?: string;
}> = ({
  label,
  value,
  displayValue,
  monospace = false,
  copyMessage,
  className = '',
  labelClassName = '',
  valueClassName = '',
}) => {
  const { useCopyClipboard, alert } = useUtils();
  const [copied, copy] = useCopyClipboard();

  useEffect(() => {
    if (copied) {
      alert.info(copyMessage || `${label} copied to clipboard`);
    }
  }, [copied, alert, copyMessage, label]);

  return (
    <div className={`flex justify-between items-center gap-4 ${className}`}>
      <Typography.Text
        className={`text-brand-gray200 text-xs flex-shrink-0 ${labelClassName}`}
      >
        {label}:
      </Typography.Text>
      <div className="flex items-center gap-1">
        <Tooltip content={value}>
          <Typography.Text
            className={`text-white text-xs text-right ${
              monospace ? 'font-mono' : ''
            } ${valueClassName}`}
          >
            {displayValue || value}
          </Typography.Text>
        </Tooltip>
        <IconButton onClick={() => copy(value)}>
          <Icon
            wrapperClassname="flex items-center justify-center"
            name="Copy"
            isSvg
            className="w-3 h-3 ml-1 text-brand-white hover:text-fields-input-borderfocus"
          />
        </IconButton>
      </div>
    </div>
  );
};

// Expandable section component
const ExpandableSection: React.FC<{
  children: React.ReactNode;
  count?: number;
  defaultExpanded?: boolean;
  title: string;
}> = ({ title, count, children, defaultExpanded = false }) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="mt-4">
      <div
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-white text-sm hover:text-fields-input-borderfocus transition-colors mb-2 cursor-pointer"
      >
        {expanded ? (
          <DownOutlined className="text-xs" />
        ) : (
          <RightOutlined className="text-xs" />
        )}
        <span>
          {title} {count !== undefined && `(${count})`}
        </span>
      </div>
      {expanded && <div className="ml-4">{children}</div>}
    </div>
  );
};

const SyscoinTransactionDetailsFromPSBTComponent: React.FC<
  ISyscoinTransactionDetailsProps
> = ({
  psbt,
  transaction,
  showTechnicalDetails = true,
  showTransactionOptions = false,
}) => {
  const { controllerEmitter } = useController();
  const { useCopyClipboard, alert } = useUtils();
  const { t } = useTranslation();
  const [decodedTx, setDecodedTx] = useState<IDecodedTransaction | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [assetInfoMap, setAssetInfoMap] = useState<Record<string, any>>({});
  const [copiedJson, copyJson] = useCopyClipboard();
  const [copiedAddress, copyAddress] = useCopyClipboard();
  const [showDetails, setShowDetails] = useState(false);

  // Use proper selectors
  const activeAccountAssets = useSelector(selectActiveAccountAssets);
  const { activeNetwork } = useSelector((state: RootState) => state.vault);

  // Avoid disruptive re-renders during background polling:
  // - Only refetch when PSBT or network changes
  // - Show loading spinner only on initial load, not on refreshes
  useEffect(() => {
    const fetchTransactionDetails = async () => {
      const psbtData = psbt || transaction?.psbt;

      if (!psbtData || !activeNetwork) return;

      // Only show blocking loader on first load
      if (!initialLoadDone) {
        setLoading(true);
      }
      try {
        const decodedData = (await controllerEmitter(
          ['wallet', 'decodeRawTransaction'],
          [psbtData]
        )) as IDecodedTransaction;
        setDecodedTx(decodedData);

        // Fetch asset information for all assets in the transaction
        if (decodedData?.syscoin?.allocations?.assets) {
          const assetMap: Record<string, any> = {};

          for (const asset of decodedData.syscoin.allocations.assets) {
            const assetGuid = asset.assetGuid;

            // First try local assets (use current snapshot without re-triggering effect)
            const localAsset = activeAccountAssets?.syscoin?.find(
              (a: any) => a.assetGuid === assetGuid
            );

            if (localAsset) {
              assetMap[assetGuid] = localAsset;
            } else {
              // If not found locally, fetch from network
              try {
                const assetData = await controllerEmitter(
                  ['wallet', 'addSysDefaultToken'],
                  [assetGuid, activeNetwork.url]
                );
                if (assetData && typeof assetData === 'object') {
                  assetMap[assetGuid] = assetData;
                }
              } catch (error) {
                console.log(
                  `Could not fetch info for asset ${assetGuid}:`,
                  error
                );
                assetMap[assetGuid] = { assetGuid, symbol: 'Unknown' };
              }
            }
          }

          setAssetInfoMap(assetMap);
        }
      } catch (error) {
        console.error('Could not decode PSBT:', error);
        setDecodedTx({ error: 'Failed to decode transaction details' });
      } finally {
        setLoading(false);
        if (!initialLoadDone) setInitialLoadDone(true);
      }
    };

    fetchTransactionDetails();
    // Only refetch when PSBT or network URL changes to avoid resets during polling
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [psbt, transaction?.psbt, activeNetwork?.url, initialLoadDone]);

  useEffect(() => {
    if (copiedJson) {
      alert.info(t('transactions.transactionJsonCopied'));
    }
  }, [copiedJson, alert]);

  useEffect(() => {
    if (copiedAddress) {
      alert.info(t('home.addressCopied'));
    }
  }, [copiedAddress, alert, t]);

  const handleCopyAsJson = () => {
    if (decodedTx) {
      const jsonData = {
        ...decodedTx,
        assetInfo: assetInfoMap,
        networkInfo: {
          name: activeNetwork.label,
          chainId: activeNetwork.chainId,
          currency: activeNetwork.currency,
        },
      };
      copyJson(JSON.stringify(jsonData, null, 2));
    }
  };

  if (loading && !initialLoadDone) {
    return (
      <div className="flex items-center justify-center p-4">
        <ClockCircleOutlined className="text-brand-royalblue text-lg animate-spin" />
      </div>
    );
  }

  if (decodedTx?.error) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2">
          <WarningOutlined className="text-warning-error" />
          <Typography.Text className="text-warning-error text-sm">
            {decodedTx.error}
          </Typography.Text>
        </div>
      </div>
    );
  }

  if (!decodedTx) return null;
  const isToken = decodedTx?.syscoin?.allocations?.assets?.length > 0;

  // Use responsive padding - less padding for dapp popup (simple mode), more for internal wallet
  const isSimpleMode = !showTechnicalDetails && !showTransactionOptions;
  const paddingClass = isSimpleMode ? 'px-3 py-4' : 'px-4 sm:px-6 lg:px-8 py-4';

  return (
    <div className={`${paddingClass} space-y-4`}>
      {/* Transaction Options (for Confirm page) */}
      {showTransactionOptions && transaction && (
        <div className="bg-brand-blue800 rounded-lg p-4 space-y-3">
          <Typography.Text strong className="text-white text-sm block">
            Transaction Options
          </Typography.Text>

          {/* RBF Status */}
          <div className="flex justify-between items-center">
            <Typography.Text className="text-brand-gray200 text-xs">
              Replace-by-Fee (RBF):
            </Typography.Text>
            <div className="flex items-center gap-1">
              {transaction.rbf === false ? (
                <>
                  <WarningOutlined className="text-warning-error text-xs" />
                  <Typography.Text className="text-warning-error text-xs">
                    Disabled
                  </Typography.Text>
                </>
              ) : (
                <>
                  <CheckCircleOutlined className="text-warning-success text-xs" />
                  <Typography.Text className="text-warning-success text-xs">
                    Enabled
                  </Typography.Text>
                </>
              )}
            </div>
          </div>

          {/* zDAG Status for tokens (inverted from RBF) */}
          {isToken && (
            <div className="flex justify-between items-center">
              <Typography.Text className="text-brand-gray200 text-xs">
                Zero-conf Protection (zDAG):
              </Typography.Text>
              <div className="flex items-center gap-1">
                {transaction.rbf === false ? (
                  <>
                    <CheckCircleOutlined className="text-warning-success text-xs" />
                    <Typography.Text className="text-warning-success text-xs">
                      Enabled
                    </Typography.Text>
                  </>
                ) : (
                  <>
                    <ClockCircleOutlined className="text-warning-error text-xs" />
                    <Typography.Text className="text-warning-error text-xs">
                      Disabled
                    </Typography.Text>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Fee Rate */}
          {transaction.feeRate && (
            <div className="flex justify-between items-center">
              <Typography.Text className="text-brand-gray200 text-xs">
                Fee Rate:
              </Typography.Text>
              <Typography.Text className="text-white text-xs">
                {transaction.feeRate.toFixed(8)}{' '}
                {activeNetwork.currency.toUpperCase()}/byte
              </Typography.Text>
            </div>
          )}
        </div>
      )}

      {/* Main Transaction Details */}
      <div className="bg-brand-blue800 rounded-lg p-4 space-y-3">
        <div className="flex justify-between items-center mb-3">
          <Typography.Text strong className="text-white text-sm sm:text-base">
            {t('send.transactionDetails')}
          </Typography.Text>
          <div className="flex items-center gap-2">
            {/* Toggle details button for dapp popup mode */}
            {!showTechnicalDetails && (
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="text-xs text-brand-gray200 hover:text-white flex items-center gap-1 transition-colors px-2 py-1 rounded hover:bg-alpha-whiteAlpha100"
                title={
                  showDetails ? t('send.hideDetails') : t('send.showDetails')
                }
              >
                {showDetails ? (
                  <DownOutlined className="text-xs" />
                ) : (
                  <RightOutlined className="text-xs" />
                )}
                <span>
                  {showDetails ? t('send.hideDetails') : t('send.showDetails')}
                </span>
              </button>
            )}
            {/* Copy as JSON button */}
            <button
              onClick={handleCopyAsJson}
              className="text-xs text-brand-gray200 hover:text-white flex items-center gap-1 transition-colors px-2 py-1 rounded hover:bg-alpha-whiteAlpha100"
              title="Copy complete transaction details as JSON"
            >
              <Icon
                wrapperClassname="flex items-center justify-center"
                name="Copy"
                isSvg
                className="w-3 h-3"
              />
              <span>Copy Details</span>
            </button>
          </div>
        </div>

        {/* Transaction Type */}
        {decodedTx.syscoin?.txtype && (
          <div className="flex justify-between items-center gap-2">
            <Typography.Text className="text-brand-gray200 text-xs sm:text-sm flex-shrink-0">
              Type:
            </Typography.Text>
            <Typography.Text className="text-white text-xs sm:text-sm font-medium text-right">
              {getTransactionTypeText(decodedTx.syscoin.txtype)}
            </Typography.Text>
          </div>
        )}

        {/* Transaction ID - only show for signed transactions */}
        {decodedTx.txid && !psbt && (
          <CopyableField
            label={t('send.transactionId')}
            value={decodedTx.txid}
            displayValue={ellipsis(decodedTx.txid, 8, 8)}
            monospace
            copyMessage={t('home.hashCopied')}
          />
        )}

        {/* For unsigned PSBTs, show a note that the transaction ID will be generated after signing */}
        {psbt && (
          <div className="flex justify-between items-center gap-2">
            <Typography.Text className="text-brand-gray200 text-xs sm:text-sm flex-shrink-0">
              {t('send.transactionId')}:
            </Typography.Text>
            <Typography.Text className="text-white text-xs sm:text-sm italic text-right">
              {t('send.willBeGeneratedAfterSigning')}
            </Typography.Text>
          </div>
        )}

        {/* Fee */}
        {decodedTx.fee !== undefined && (
          <div className="flex justify-between items-center gap-2">
            <Typography.Text className="text-brand-gray200 text-xs sm:text-sm flex-shrink-0">
              {t('send.networkFee')}:
            </Typography.Text>
            <Typography.Text className="text-white text-xs sm:text-sm text-right">
              {decodedTx.fee} {activeNetwork.currency.toUpperCase()}
            </Typography.Text>
          </div>
        )}

        {/* Size - show conditionally based on detail toggle */}
        {(showTechnicalDetails || showDetails) && decodedTx.vsize && (
          <div className="flex justify-between items-center gap-2">
            <Typography.Text className="text-brand-gray200 text-xs sm:text-sm flex-shrink-0">
              {t('send.size')}:
            </Typography.Text>
            <Typography.Text className="text-white text-xs sm:text-sm text-right">
              {decodedTx.vsize} vbytes
            </Typography.Text>
          </div>
        )}
      </div>

      {/* Asset Transfers - show all assets involved */}
      {(() => (
        <div className="space-y-3">
          <Typography.Text className="text-white text-sm font-medium">
            {t('send.assetsInvolved')}
          </Typography.Text>
          <div className="space-y-2">
            {Array.from(decodedTx.syscoin?.allocations?.assets || []).map(
              (primaryAsset, index) => {
                // Get asset info for the primary asset
                const assetInfo = assetInfoMap[primaryAsset.assetGuid] || {
                  assetGuid: primaryAsset.assetGuid,
                  symbol:
                    primaryAsset.assetGuid === '123456' ? 'SYSX' : 'Unknown',
                  decimals: 8,
                };

                // Don't ellipsis short asset GUIDs
                const displayGuid =
                  primaryAsset.assetGuid.length <= 10
                    ? primaryAsset.assetGuid
                    : ellipsis(primaryAsset.assetGuid, 12, 12);

                return (
                  <div
                    key={`asset-${primaryAsset.assetGuid}-${index}`}
                    className="bg-brand-blue800 p-4 rounded-lg"
                  >
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <Typography.Text className="text-white text-base sm:text-lg font-semibold">
                          {assetInfo.symbol}
                        </Typography.Text>
                      </div>

                      <div className="pt-2 border-t border-alpha-whiteAlpha100">
                        <CopyableField
                          label={t('send.assetGuid')}
                          value={primaryAsset.assetGuid}
                          displayValue={displayGuid}
                          monospace
                          copyMessage={t('home.assetGuidCopied')}
                          className="text-xs sm:text-sm"
                          labelClassName="text-xs sm:text-sm"
                          valueClassName="text-xs sm:text-sm"
                        />
                      </div>
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </div>
      ))()}

      {/* Outputs Summary - show based on technical details or detail toggle */}
      {(showTechnicalDetails || showDetails) &&
        decodedTx.vout &&
        decodedTx.vout.length > 0 && (
          <ExpandableSection
            title={t('send.outputs')}
            count={decodedTx.vout.length}
            defaultExpanded={decodedTx.vout.length <= 3}
          >
            <div className="space-y-2">
              {decodedTx.vout.map((output: any, index: number) => {
                // Check if this output contains any asset allocations
                let assetInfo = null;
                let assetAmount = null;

                // First check if output has embedded assetInfo
                if (output.assetInfo) {
                  // Find asset info
                  assetInfo = activeAccountAssets?.syscoin?.find(
                    (a: any) => a.assetGuid === output.assetInfo.assetGuid
                  ) ||
                    assetInfoMap[output.assetInfo.assetGuid] || {
                      assetGuid: output.assetInfo.assetGuid,
                      symbol:
                        output.assetInfo.assetGuid === '123456'
                          ? 'SYSX'
                          : 'SPT',
                      decimals: 8,
                    };
                  // Get the amount
                  if (output.assetInfo.value) {
                    assetAmount = formatSyscoinValue(
                      output.assetInfo.value.toString(),
                      assetInfo.decimals || 8
                    );
                  }
                } else if (decodedTx.syscoin?.allocations?.assets) {
                  // Check if this output index has an asset allocation
                  for (const asset of decodedTx.syscoin.allocations.assets) {
                    const allocation = asset.values?.find(
                      (v: any) => v.n === index
                    );
                    if (allocation) {
                      assetInfo = assetInfoMap[asset.assetGuid] || {
                        assetGuid: asset.assetGuid,
                        symbol:
                          asset.assetGuid === '123456' ? 'SYSX' : 'Unknown',
                        decimals: 8,
                      };
                      assetAmount = formatSyscoinValue(
                        allocation.value.toString(),
                        assetInfo.decimals || 8
                      );
                      break;
                    }
                  }
                }
                return (
                  <div
                    key={index}
                    className="bg-brand-blue800 p-3 rounded transition-colors hover:bg-alpha-whiteAlpha100"
                  >
                    <div className="space-y-2">
                      {/* Output header with index */}
                      <div className="flex items-center justify-between gap-2">
                        <Typography.Text className="text-brand-gray200 text-xs sm:text-sm flex-shrink-0">
                          Output #{index}
                        </Typography.Text>
                        <div className="text-right">
                          <Typography.Text className="text-white text-xs sm:text-sm font-medium block">
                            {output.value}{' '}
                            {activeNetwork.currency.toUpperCase()}
                          </Typography.Text>
                          {assetInfo && assetAmount && (
                            <Typography.Text className="text-brand-royalblue text-xs sm:text-sm font-medium block mt-1">
                              {assetAmount} {assetInfo.symbol || 'SYSX'}
                            </Typography.Text>
                          )}
                        </div>
                      </div>

                      {/* Address section */}
                      {output.scriptPubKey?.addresses?.[0] ? (
                        <div className="flex items-center justify-between bg-brand-blue900 p-2 rounded gap-2">
                          <Typography.Text className="text-brand-gray200 text-xs sm:text-sm flex-shrink-0">
                            Address:
                          </Typography.Text>
                          <div className="flex items-center gap-1">
                            <Tooltip content={output.scriptPubKey.addresses[0]}>
                              <Typography.Text className="text-white text-xs sm:text-sm font-mono">
                                {ellipsis(
                                  output.scriptPubKey.addresses[0],
                                  10,
                                  10
                                )}
                              </Typography.Text>
                            </Tooltip>
                            <IconButton
                              onClick={() =>
                                copyAddress(output.scriptPubKey.addresses[0])
                              }
                              className="flex-shrink-0"
                            >
                              <Icon
                                wrapperClassname="flex items-center justify-center"
                                name="Copy"
                                isSvg
                                className="w-3 h-3 text-brand-white hover:text-fields-input-borderfocus"
                              />
                            </IconButton>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between bg-brand-blue900 p-2 rounded gap-2">
                          <Typography.Text className="text-brand-gray200 text-xs sm:text-sm flex-shrink-0">
                            Type:
                          </Typography.Text>
                          <Typography.Text className="text-white text-xs sm:text-sm text-right">
                            {output.scriptPubKey?.type === 'nulldata'
                              ? 'OP_RETURN (Data)'
                              : output.scriptPubKey?.type || 'Unknown'}
                          </Typography.Text>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ExpandableSection>
        )}

      {/* Syscoin-specific Data (Bridge operations, etc.) */}
      {decodedTx.syscoin && (
        <>
          {/* Burn Data - only show metadata specific to burns */}
          {decodedTx.syscoin.burn?.ethaddress && (
            <div className="bg-brand-blue800 rounded-lg p-4 space-y-2">
              <Typography.Text className="text-white text-sm sm:text-base block font-medium">
                Bridge to NEVM
              </Typography.Text>
              <CopyableField
                label="NEVM Address"
                value={decodedTx.syscoin.burn.ethaddress}
                displayValue={ellipsis(decodedTx.syscoin.burn.ethaddress, 8, 8)}
                monospace
                copyMessage={t('home.addressCopied')}
                labelClassName="text-xs sm:text-sm"
                valueClassName="text-xs sm:text-sm"
              />
            </div>
          )}

          {/* Mint Data - only show metadata specific to mints */}
          {decodedTx.syscoin.mint && (
            <div className="bg-brand-blue800 rounded-lg p-4 space-y-2">
              <Typography.Text className="text-white text-sm block font-medium">
                Bridge from NEVM
              </Typography.Text>

              {decodedTx.syscoin.mint.ethtxid && (
                <CopyableField
                  label="NEVM TXID"
                  value={decodedTx.syscoin.mint.ethtxid}
                  displayValue={ellipsis(decodedTx.syscoin.mint.ethtxid, 8, 8)}
                  monospace
                  copyMessage={t('home.hashCopied')}
                />
              )}

              {decodedTx.syscoin.mint.blockhash && (
                <CopyableField
                  label="Block Hash"
                  value={decodedTx.syscoin.mint.blockhash}
                  displayValue={ellipsis(
                    decodedTx.syscoin.mint.blockhash,
                    8,
                    8
                  )}
                  monospace
                  copyMessage={t('home.hashCopied')}
                />
              )}
            </div>
          )}

          {/* PoDA Data */}
          {decodedTx.syscoin.poda && (
            <div className="bg-brand-blue800 rounded-lg p-4 space-y-2">
              <Typography.Text className="text-white text-sm block font-medium">
                PoDA (Proof of Data Availability):
              </Typography.Text>
              <CopyableField
                label="Blob Hash"
                value={decodedTx.syscoin.poda.blobHash}
                displayValue={ellipsis(decodedTx.syscoin.poda.blobHash, 10, 10)}
                monospace
                copyMessage={t('home.hashCopied')}
              />
            </div>
          )}
        </>
      )}

      {/* Technical Details - now also show when detail toggle is enabled */}
      {(showTechnicalDetails || showDetails) && decodedTx && (
        <>
          <div className="border-dashed border-alpha-whiteAlpha300 border-t my-4" />

          <div className="space-y-3">
            <Typography.Text className="text-white text-sm block font-medium">
              Technical Details:
            </Typography.Text>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Typography.Text className="text-brand-gray200 text-xs">
                  Version:
                </Typography.Text>
                <Typography.Text className="text-white text-xs">
                  {decodedTx.version}
                </Typography.Text>
              </div>

              {decodedTx.size && (
                <div className="flex justify-between items-center">
                  <Typography.Text className="text-brand-gray200 text-xs">
                    Size:
                  </Typography.Text>
                  <Typography.Text className="text-white text-xs">
                    {decodedTx.size} bytes
                  </Typography.Text>
                </div>
              )}

              {decodedTx.weight && (
                <div className="flex justify-between items-center">
                  <Typography.Text className="text-brand-gray200 text-xs">
                    Weight:
                  </Typography.Text>
                  <Typography.Text className="text-white text-xs">
                    {decodedTx.weight} WU
                  </Typography.Text>
                </div>
              )}

              {decodedTx.locktime !== undefined && (
                <div className="flex justify-between items-center">
                  <Typography.Text className="text-brand-gray200 text-xs">
                    Lock Time:
                  </Typography.Text>
                  <Typography.Text className="text-white text-xs">
                    {decodedTx.locktime}
                  </Typography.Text>
                </div>
              )}
            </div>

            {/* Inputs Details */}
            {decodedTx.vin && decodedTx.vin.length > 0 && (
              <ExpandableSection
                title={t('send.inputs')}
                count={decodedTx.vin.length}
                defaultExpanded={decodedTx.vin.length <= 3}
              >
                <div className="space-y-2">
                  {decodedTx.vin.map((input: any, index: number) => (
                    <div
                      key={index}
                      className="bg-brand-blue800 p-3 rounded space-y-1"
                    >
                      {/* Input header with index and asset amount if available */}
                      <div className="flex items-center justify-between mb-2">
                        <Typography.Text className="text-brand-gray200 text-xs">
                          Input #{index}
                        </Typography.Text>
                        <div className="text-right">
                          {input.value !== undefined && (
                            <Typography.Text className="text-white text-xs font-medium block">
                              {input.value}{' '}
                              {activeNetwork.currency.toUpperCase()}
                            </Typography.Text>
                          )}
                          {input.assetInfo && (
                            <Typography.Text className="text-brand-royalblue text-xs font-medium block mt-1">
                              {input.assetInfo.value
                                ? formatSyscoinValue(
                                    input.assetInfo.value.toString(),
                                    input.assetInfo.decimals || 8
                                  )
                                : '0'}{' '}
                              {input.assetInfo.symbol ||
                                (input.assetInfo.assetGuid === '123456'
                                  ? 'SYSX'
                                  : 'SPT')}
                            </Typography.Text>
                          )}
                        </div>
                      </div>

                      {input.txid ? (
                        <CopyableField
                          label="TXID"
                          value={input.txid}
                          displayValue={ellipsis(input.txid, 12, 12)}
                          monospace
                          copyMessage={t('home.hashCopied')}
                        />
                      ) : (
                        <div className="flex justify-between items-center">
                          <Typography.Text className="text-brand-gray200 text-xs">
                            Type:
                          </Typography.Text>
                          <Typography.Text className="text-white text-xs">
                            Coinbase
                          </Typography.Text>
                        </div>
                      )}

                      {input.vout !== undefined && (
                        <div className="flex justify-between items-center">
                          <Typography.Text className="text-brand-gray200 text-xs">
                            Output:
                          </Typography.Text>
                          <Typography.Text className="text-white text-xs">
                            {input.vout}
                          </Typography.Text>
                        </div>
                      )}

                      {input.sequence !== undefined && (
                        <div className="flex justify-between items-center">
                          <Typography.Text className="text-brand-gray200 text-xs">
                            Sequence:
                          </Typography.Text>
                          <Typography.Text className="text-white text-xs font-mono">
                            {input.sequence.toString(16).padStart(8, '0')}
                          </Typography.Text>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </ExpandableSection>
            )}
          </div>
        </>
      )}
    </div>
  );
};

// Memoize the component to prevent unnecessary re-renders during rapid polling
export const SyscoinTransactionDetailsFromPSBT = React.memo(
  SyscoinTransactionDetailsFromPSBTComponent,
  (prevProps, nextProps) =>
    // Custom comparison function - only re-render if the PSBT data changes
    prevProps.psbt === nextProps.psbt &&
    prevProps.transaction?.psbt === nextProps.transaction?.psbt &&
    prevProps.showTechnicalDetails === nextProps.showTechnicalDetails &&
    prevProps.showTransactionOptions === nextProps.showTransactionOptions
);
