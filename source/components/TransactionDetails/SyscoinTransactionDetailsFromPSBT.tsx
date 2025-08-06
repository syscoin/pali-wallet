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
      allocation?: Array<{
        assetGuid: string;
        values?: Array<{
          n: number;
          value: string;
          valueFormatted?: string;
        }>;
      }>;
      ethaddress: string;
    };
    mint?: {
      allocation?: Array<{
        assetGuid: string;
        values?: Array<{
          n: number;
          value: string;
          valueFormatted?: string;
        }>;
      }>;
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
    <div className={`flex justify-between items-center ${className}`}>
      <Typography.Text
        className={`text-brand-gray200 text-xs ${labelClassName}`}
      >
        {label}:
      </Typography.Text>
      <div className="flex items-center gap-1">
        <Tooltip content={value}>
          <Typography.Text
            className={`text-white text-xs ${
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

export const SyscoinTransactionDetailsFromPSBT: React.FC<
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
  const [assetInfoMap, setAssetInfoMap] = useState<Record<string, any>>({});
  const [copiedJson, copyJson] = useCopyClipboard();
  const [copiedAddress, copyAddress] = useCopyClipboard();

  // Use proper selectors
  const activeAccountAssets = useSelector(selectActiveAccountAssets);
  const { activeNetwork } = useSelector((state: RootState) => state.vault);

  useEffect(() => {
    const fetchTransactionDetails = async () => {
      const psbtData = psbt || transaction?.psbt;

      if (!psbtData || !activeNetwork) return;

      setLoading(true);
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

            // First try local assets
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
      }
    };

    fetchTransactionDetails();
  }, [
    psbt,
    transaction,
    activeNetwork,
    activeAccountAssets,
    controllerEmitter,
  ]);

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

  if (loading) {
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

  // Use minimal padding when used as a simple display (no technical details/transaction options)
  const isSimpleMode = !showTechnicalDetails && !showTransactionOptions;
  const paddingClass = isSimpleMode ? 'px-2 py-4' : 'px-4 sm:px-6 py-4';

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
          <Typography.Text strong className="text-white text-sm">
            Transaction Details
          </Typography.Text>
          {/* Copy as JSON button - moved here for better visibility */}
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

        {/* Transaction Type */}
        {decodedTx.syscoin?.txtype && (
          <div className="flex justify-between items-center">
            <Typography.Text className="text-brand-gray200 text-xs">
              Type:
            </Typography.Text>
            <Typography.Text className="text-white text-xs font-medium">
              {getTransactionTypeText(decodedTx.syscoin.txtype)}
            </Typography.Text>
          </div>
        )}

        {/* Transaction ID */}
        {decodedTx.txid && (
          <CopyableField
            label="Transaction ID"
            value={decodedTx.txid}
            displayValue={ellipsis(decodedTx.txid, 8, 8)}
            monospace
            copyMessage={t('home.hashCopied')}
          />
        )}

        {/* Fee */}
        {decodedTx.fee !== undefined && (
          <div className="flex justify-between items-center">
            <Typography.Text className="text-brand-gray200 text-xs">
              Network Fee:
            </Typography.Text>
            <Typography.Text className="text-white text-xs">
              {decodedTx.fee} {activeNetwork.currency.toUpperCase()}
            </Typography.Text>
          </div>
        )}

        {/* Size */}
        {decodedTx.vsize && (
          <div className="flex justify-between items-center">
            <Typography.Text className="text-brand-gray200 text-xs">
              Size:
            </Typography.Text>
            <Typography.Text className="text-white text-xs">
              {decodedTx.vsize} vbytes
            </Typography.Text>
          </div>
        )}
      </div>

      {/* Asset Transfers - improved layout */}
      {isToken && decodedTx.syscoin?.allocations?.assets && (
        <div className="space-y-3">
          <Typography.Text className="text-white text-sm font-medium">
            Asset Transfers
          </Typography.Text>
          {decodedTx.syscoin.allocations.assets.map(
            (asset: any, index: number) => {
              const assetInfo = assetInfoMap[asset.assetGuid] || {
                assetGuid: asset.assetGuid,
                symbol: 'Unknown',
              };
              const totalAmount =
                asset.values?.reduce(
                  (sum: number, val: any) =>
                    sum + parseFloat(formatSyscoinValue(val.value.toString())),
                  0
                ) || 0;

              // Don't ellipsis short asset GUIDs
              const displayGuid =
                asset.assetGuid.length <= 10
                  ? asset.assetGuid
                  : ellipsis(asset.assetGuid, 12, 12);

              return (
                <div key={index} className="bg-brand-blue800 p-4 rounded-lg">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <Typography.Text className="text-white text-base font-semibold">
                          {assetInfo.symbol}
                        </Typography.Text>
                        <Typography.Text className="text-brand-gray200 text-xs mt-1 block">
                          Amount: {totalAmount.toFixed(assetInfo.decimals || 8)}{' '}
                          {assetInfo.symbol}
                        </Typography.Text>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-alpha-whiteAlpha100">
                      <CopyableField
                        label={t('send.assetGuid')}
                        value={asset.assetGuid}
                        displayValue={displayGuid}
                        monospace
                        copyMessage={t('home.assetGuidCopied')}
                        className="text-xs"
                      />
                    </div>

                    {asset.values && asset.values.length > 1 && (
                      <ExpandableSection
                        title={t('send.outputBreakdown')}
                        defaultExpanded={false}
                      >
                        <div className="space-y-1">
                          {asset.values.map((val: any, valIndex: number) => (
                            <div
                              key={valIndex}
                              className="text-brand-gray200 text-xs"
                            >
                              Output #{val.n}:{' '}
                              {val.valueFormatted ||
                                formatSyscoinValue(val.value.toString())}{' '}
                              {assetInfo.symbol}
                            </div>
                          ))}
                        </div>
                      </ExpandableSection>
                    )}
                  </div>
                </div>
              );
            }
          )}
        </div>
      )}

      {/* Outputs Summary */}
      {decodedTx.vout && decodedTx.vout.length > 0 && !isToken && (
        <ExpandableSection
          title={t('send.outputs')}
          count={decodedTx.vout.length}
          defaultExpanded={decodedTx.vout.length <= 3}
        >
          <div className="space-y-2">
            {(() => {
              // Pre-process to find first mint output (intent)
              let firstMintOutput = -1;
              let firstBurnOutput = -1;

              if (decodedTx.syscoin?.mint?.allocation) {
                for (const allocation of decodedTx.syscoin.mint.allocation) {
                  const sortedValues = [...(allocation.values || [])].sort(
                    (a, b) => a.n - b.n
                  );
                  if (sortedValues.length > 0) {
                    firstMintOutput = sortedValues[0].n; // First output is intent
                    break;
                  }
                }
              }

              if (decodedTx.syscoin?.burn?.allocation) {
                for (const allocation of decodedTx.syscoin.burn.allocation) {
                  const sortedValues = [...(allocation.values || [])].sort(
                    (a, b) => a.n - b.n
                  );
                  if (sortedValues.length > 0) {
                    firstBurnOutput = sortedValues[0].n;
                    break;
                  }
                }
              }

              return decodedTx.vout.map((output: any, index: number) => {
                // Check if this output contains asset allocations
                let assetInfo = null;
                let assetAmount = null;
                let rawAssetValue = null;
                let outputType = null; // 'intent', 'change', or null
                let isFromMint = false;
                let isFromBurn = false;

                // For mint transactions, check mint allocations first
                if (decodedTx.syscoin?.mint?.allocation) {
                  for (const allocation of decodedTx.syscoin.mint.allocation) {
                    const valueForOutput = allocation.values?.find(
                      (val: any) => val.n === index
                    );
                    if (valueForOutput) {
                      // For mint transactions, find asset info
                      assetInfo = activeAccountAssets?.syscoin?.find(
                        (a: any) => a.assetGuid === allocation.assetGuid
                      ) || {
                        assetGuid: allocation.assetGuid,
                        symbol: 'SYSX',
                        decimals: 8,
                      };
                      // Use valueFormatted if available, otherwise store raw value
                      if (valueForOutput.valueFormatted) {
                        assetAmount = valueForOutput.valueFormatted;
                      } else {
                        rawAssetValue = valueForOutput.value;
                      }
                      isFromMint = true;
                      break;
                    }
                  }
                }

                // Check standard allocations if not found in mint
                if (!assetInfo && decodedTx.syscoin?.allocations?.assets) {
                  for (const asset of decodedTx.syscoin.allocations.assets) {
                    const valueForOutput = asset.values?.find(
                      (val: any) => val.n === index
                    );
                    if (valueForOutput) {
                      assetInfo = activeAccountAssets?.syscoin?.find(
                        (a: any) => a.assetGuid === asset.assetGuid
                      ) || {
                        assetGuid: asset.assetGuid,
                        symbol: 'SYSX',
                        decimals: 8,
                      };
                      // Use valueFormatted if available, otherwise store raw value
                      if (valueForOutput.valueFormatted) {
                        assetAmount = valueForOutput.valueFormatted;
                      } else {
                        rawAssetValue = valueForOutput.value;
                      }
                      break;
                    }
                  }
                }

                // Check burn allocations
                if (!assetInfo && decodedTx.syscoin?.burn?.allocation) {
                  for (const allocation of decodedTx.syscoin.burn.allocation) {
                    const valueForOutput = allocation.values?.find(
                      (val: any) => val.n === index
                    );
                    if (valueForOutput) {
                      assetInfo = activeAccountAssets?.syscoin?.find(
                        (a: any) => a.assetGuid === allocation.assetGuid
                      ) || {
                        assetGuid: allocation.assetGuid,
                        symbol: 'SYSX',
                        decimals: 8,
                      };
                      // Use valueFormatted if available, otherwise store raw value
                      if (valueForOutput.valueFormatted) {
                        assetAmount = valueForOutput.valueFormatted;
                      } else {
                        rawAssetValue = valueForOutput.value;
                      }
                      isFromBurn = true;
                      break;
                    }
                  }
                }

                // Format the asset amount using proper decimals
                if (rawAssetValue && !assetAmount) {
                  const decimals = assetInfo?.decimals || 8; // Default to 8 if not specified
                  assetAmount = formatSyscoinValue(rawAssetValue, decimals);
                }

                // Determine intent vs change based on transaction type and consensus rules
                const txType = decodedTx.syscoin?.txtype;
                if (assetInfo && assetAmount) {
                  switch (txType) {
                    case 'assetallocation_mint':
                      // For mint transactions, only the first output with mint allocation is intent
                      if (isFromMint) {
                        outputType =
                          index === firstMintOutput ? 'intent' : 'change';
                      }
                      break;

                    case 'assetallocationburn_to_ethereum':
                    case 'assetallocationburn_to_syscoin':
                      // For burn transactions, only the first burn output is intent
                      if (isFromBurn) {
                        outputType =
                          index === firstBurnOutput ? 'intent' : 'change';
                      }
                      break;

                    case 'syscoinburn_to_allocation':
                      // The new allocation output is intent
                      outputType = 'intent';
                      break;

                    case 'assetallocation_send':
                      // For regular SPT sends, we can't easily determine intent vs change
                      // Multiple outputs could be intent (sending to multiple recipients)
                      // So we don't label these
                      outputType = null;
                      break;

                    default:
                      // For other types, don't label
                      outputType = null;
                  }
                }

                return (
                  <div
                    key={index}
                    className="bg-brand-blue800 p-3 rounded transition-colors hover:bg-alpha-whiteAlpha100"
                  >
                    <div className="space-y-2">
                      {/* Output header with index and optional type */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Typography.Text className="text-brand-gray200 text-xs">
                            Output #{index}
                          </Typography.Text>
                          {outputType && (
                            <span
                              className={`text-xs px-2 py-0.5 rounded ${
                                outputType === 'intent'
                                  ? 'bg-brand-royalblue text-white'
                                  : 'bg-alpha-whiteAlpha200 text-brand-gray200'
                              }`}
                            >
                              {outputType === 'intent' ? 'Intent' : 'Change'}
                            </span>
                          )}
                        </div>
                        <div className="text-right">
                          <Typography.Text className="text-white text-xs font-medium block">
                            {output.value}{' '}
                            {activeNetwork.currency.toUpperCase()}
                          </Typography.Text>
                          {assetInfo && assetAmount && (
                            <Typography.Text className="text-brand-royalblue text-xs font-medium block mt-1">
                              {assetAmount} {assetInfo.symbol || 'SYSX'}
                            </Typography.Text>
                          )}
                        </div>
                      </div>

                      {/* Address section */}
                      {output.scriptPubKey?.addresses?.[0] ? (
                        <div className="flex items-center gap-2 bg-brand-blue900 p-2 rounded">
                          <Typography.Text className="text-brand-gray200 text-xs flex-shrink-0">
                            Address:
                          </Typography.Text>
                          <div className="flex items-center gap-1 flex-1 min-w-0">
                            <Tooltip content={output.scriptPubKey.addresses[0]}>
                              <Typography.Text className="text-white text-xs font-mono truncate block max-w-[150px]">
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
                        <div className="bg-brand-blue900 p-2 rounded">
                          <Typography.Text className="text-brand-gray200 text-xs">
                            Type:{' '}
                            <span className="text-white">
                              {output.scriptPubKey?.type || 'Unknown'}
                            </span>
                          </Typography.Text>
                        </div>
                      )}
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </ExpandableSection>
      )}

      {/* Syscoin-specific Data (Bridge operations, etc.) */}
      {decodedTx.syscoin && (
        <>
          {/* Burn Data */}
          {decodedTx.syscoin.burn && (
            <div className="bg-brand-blue800 rounded-lg p-4 space-y-2">
              <Typography.Text className="text-white text-sm block font-medium">
                Burn Data:
              </Typography.Text>

              {/* Display burn amount if available */}
              {decodedTx.syscoin.burn.allocation &&
                decodedTx.syscoin.burn.allocation.length > 0 && (
                  <div className="space-y-2">
                    {decodedTx.syscoin.burn.allocation.map(
                      (allocation, index) => {
                        // Calculate total amount from values
                        const totalAmount =
                          allocation.values?.reduce((sum, val) => {
                            if (val.valueFormatted) {
                              return sum + parseFloat(val.valueFormatted);
                            }
                            return sum + parseFloat(val.value) / 100000000;
                          }, 0) || 0;

                        // Get asset info if available
                        const assetInfo = activeAccountAssets?.syscoin?.find(
                          (asset: any) =>
                            asset.assetGuid === allocation.assetGuid
                        );

                        // Determine the asset symbol based on the transaction type
                        let assetSymbol = assetInfo?.symbol || 'SYSX';
                        if (
                          decodedTx.syscoin.txtype ===
                          'syscoinburn_to_allocation'
                        ) {
                          assetSymbol = 'SYS'; // Burning SYS to SYSX
                        } else if (
                          decodedTx.syscoin.txtype ===
                          'assetallocationburn_to_syscoin'
                        ) {
                          assetSymbol = 'SYSX'; // Burning SYSX to SYS
                        }

                        return (
                          <div
                            key={index}
                            className="bg-brand-blue900 rounded p-2"
                          >
                            <div className="flex items-center justify-between">
                              <Typography.Text className="text-brand-gray200 text-xs">
                                Amount:
                              </Typography.Text>
                              <Typography.Text className="text-white text-sm font-medium">
                                {totalAmount.toFixed(8)} {assetSymbol}
                              </Typography.Text>
                            </div>
                            {allocation.assetGuid &&
                              allocation.assetGuid !== '0' && (
                                <div className="flex items-center justify-between mt-1">
                                  <Typography.Text className="text-brand-gray200 text-xs">
                                    Asset ID:
                                  </Typography.Text>
                                  <Typography.Text className="text-white text-xs font-mono">
                                    {allocation.assetGuid}
                                  </Typography.Text>
                                </div>
                              )}
                          </div>
                        );
                      }
                    )}
                  </div>
                )}

              <CopyableField
                label="NEVM Address"
                value={decodedTx.syscoin.burn.ethaddress}
                displayValue={ellipsis(decodedTx.syscoin.burn.ethaddress, 8, 8)}
                monospace
                copyMessage={t('home.addressCopied')}
              />
            </div>
          )}

          {/* Mint Data */}
          {decodedTx.syscoin.mint && (
            <div className="bg-brand-blue800 rounded-lg p-4 space-y-2">
              <Typography.Text className="text-white text-sm block font-medium">
                Mint Data:
              </Typography.Text>

              {/* Display mint amount if available */}
              {decodedTx.syscoin.mint.allocation &&
                decodedTx.syscoin.mint.allocation.length > 0 && (
                  <div className="space-y-2">
                    {decodedTx.syscoin.mint.allocation.map(
                      (allocation, index) => {
                        // For mint, only show the intent amount (first output with this asset)
                        // Find the first output with this asset (the intent)
                        const sortedValues = [
                          ...(allocation.values || []),
                        ].sort((a, b) => a.n - b.n);
                        const intentValue = sortedValues[0]; // First output is the intent

                        let intentAmount = 0;
                        if (intentValue) {
                          if (intentValue.valueFormatted) {
                            intentAmount = parseFloat(
                              intentValue.valueFormatted
                            );
                          } else {
                            intentAmount =
                              parseFloat(intentValue.value) / 100000000;
                          }
                        }

                        // Get asset info if available
                        const assetInfo = activeAccountAssets?.syscoin?.find(
                          (asset: any) =>
                            asset.assetGuid === allocation.assetGuid
                        );

                        return (
                          <div
                            key={index}
                            className="bg-brand-blue900 rounded p-2"
                          >
                            <div className="flex items-center justify-between">
                              <Typography.Text className="text-brand-gray200 text-xs">
                                Amount:
                              </Typography.Text>
                              <Typography.Text className="text-white text-sm font-medium">
                                {intentAmount.toFixed(8)}{' '}
                                {assetInfo?.symbol || 'SYSX'}
                              </Typography.Text>
                            </div>
                            {allocation.assetGuid && (
                              <div className="flex items-center justify-between mt-1">
                                <Typography.Text className="text-brand-gray200 text-xs">
                                  Asset ID:
                                </Typography.Text>
                                <Typography.Text className="text-white text-xs font-mono">
                                  {allocation.assetGuid}
                                </Typography.Text>
                              </div>
                            )}
                          </div>
                        );
                      }
                    )}
                  </div>
                )}

              <CopyableField
                label="NEVM TXID"
                value={decodedTx.syscoin.mint.ethtxid}
                displayValue={ellipsis(decodedTx.syscoin.mint.ethtxid, 8, 8)}
                monospace
                copyMessage={t('home.hashCopied')}
              />
              <CopyableField
                label="Block Hash"
                value={decodedTx.syscoin.mint.blockhash}
                displayValue={ellipsis(decodedTx.syscoin.mint.blockhash, 8, 8)}
                monospace
                copyMessage={t('home.hashCopied')}
              />
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

      {/* Technical Details */}
      {showTechnicalDetails && decodedTx && (
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
