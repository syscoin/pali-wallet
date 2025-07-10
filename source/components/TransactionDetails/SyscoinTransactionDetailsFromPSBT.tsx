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
  switch (txtype) {
    case 'assetallocationburn_to_syscoin':
      return 'Bridge: Burn SYSX to SYS';
    case 'syscoinburn_to_allocation':
      return 'Bridge: Burn SYS to SYSX';
    case 'assetallocation_mint':
      return 'Bridge: Mint from NEVM';
    case 'assetallocationburn_to_ethereum':
      return 'Bridge: Burn to NEVM';
    case 'assetallocation_send':
      return 'Asset Transfer';
    case 'nevm_data':
      return 'NEVM Data Transaction';
    case 'bitcoin':
      return 'Standard Transaction';
    default:
      return txtype || 'Unknown';
  }
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
      {/* Copy as JSON button */}
      <div className="flex justify-end">
        <button
          onClick={handleCopyAsJson}
          className="text-xs text-brand-gray200 hover:text-white flex items-center gap-1 transition-colors px-2 py-1 rounded hover:bg-alpha-whiteAlpha100"
        >
          <Icon
            wrapperClassname="flex items-center justify-center"
            name="Copy"
            isSvg
            className="w-3 h-3"
          />
          <span>Copy as JSON</span>
        </button>
      </div>

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
      <div className="space-y-3">
        <Typography.Text strong className="text-white text-sm block">
          Transaction Details
        </Typography.Text>

        {/* Transaction Type */}
        {decodedTx.syscoin?.txtype && (
          <div className="flex justify-between items-center">
            <Typography.Text className="text-brand-gray200 text-xs">
              Type:
            </Typography.Text>
            <Typography.Text className="text-white text-xs">
              {getTransactionTypeText(decodedTx.syscoin.txtype)}
            </Typography.Text>
          </div>
        )}

        {/* Transaction ID */}
        {decodedTx.txid && (
          <CopyableField
            label="Transaction ID"
            value={decodedTx.txid}
            displayValue={ellipsis(decodedTx.txid, 10, 10)}
            monospace
            copyMessage={t('home.hashCopied')}
          />
        )}

        {/* Fee */}
        {decodedTx.fee !== undefined && (
          <div className="flex justify-between items-center">
            <Typography.Text className="text-brand-gray200 text-xs">
              Fee:
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

        {/* Asset Transfers */}
        {isToken && decodedTx.syscoin?.allocations?.assets && (
          <div className="mt-4">
            <Typography.Text className="text-white text-sm mb-2 block">
              Asset Transfers:
            </Typography.Text>
            {decodedTx.syscoin.allocations.assets.map(
              (asset: any, index: number) => {
                const assetInfo = assetInfoMap[asset.assetGuid] || {
                  assetGuid: asset.assetGuid,
                  symbol: 'Unknown',
                };
                const totalAmount =
                  asset.values?.reduce(
                    (sum: number, val: any) => sum + val.value / 1e8,
                    0
                  ) || 0;

                return (
                  <div
                    key={index}
                    className="bg-brand-blue800 p-3 rounded-lg mb-2"
                  >
                    <div className="flex justify-between items-center">
                      <Typography.Text className="text-white text-xs font-semibold">
                        {assetInfo.symbol}
                      </Typography.Text>
                      <Typography.Text className="text-white text-xs">
                        {totalAmount.toFixed(assetInfo.decimals || 8)}{' '}
                        {assetInfo.symbol}
                      </Typography.Text>
                    </div>
                    <CopyableField
                      label="Asset GUID"
                      value={asset.assetGuid}
                      displayValue={ellipsis(asset.assetGuid, 12, 12)}
                      monospace
                      copyMessage={t('home.assetGuidCopied')}
                    />
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
                                `${(val.value / 1e8).toFixed(8)}`}{' '}
                              {assetInfo.symbol}
                            </div>
                          ))}
                        </div>
                      </ExpandableSection>
                    )}
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
              {decodedTx.vout.map((output: any, index: number) => (
                <div key={index} className="bg-brand-blue800 p-3 rounded">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <Typography.Text className="text-brand-gray200 text-xs block mb-1">
                        Output #{index}:
                      </Typography.Text>
                      {output.scriptPubKey?.addresses?.[0] ? (
                        <div className="flex items-center gap-1">
                          <Tooltip content={output.scriptPubKey.addresses[0]}>
                            <Typography.Text className="text-white text-xs font-mono truncate">
                              {ellipsis(
                                output.scriptPubKey.addresses[0],
                                12,
                                12
                              )}
                            </Typography.Text>
                          </Tooltip>
                          <IconButton
                            onClick={() =>
                              copyAddress(output.scriptPubKey.addresses[0])
                            }
                          >
                            <Icon
                              wrapperClassname="flex items-center justify-center"
                              name="Copy"
                              isSvg
                              className="w-3 h-3 text-brand-white hover:text-fields-input-borderfocus"
                            />
                          </IconButton>
                        </div>
                      ) : (
                        <Typography.Text className="text-white text-xs">
                          {output.scriptPubKey?.type || 'Unknown'}
                        </Typography.Text>
                      )}
                    </div>
                    <Typography.Text className="text-white text-xs font-medium whitespace-nowrap mt-5">
                      {output.value} {activeNetwork.currency.toUpperCase()}
                    </Typography.Text>
                  </div>
                </div>
              ))}
            </div>
          </ExpandableSection>
        )}
      </div>

      {/* Syscoin-specific Data (Bridge operations, etc.) */}
      {decodedTx.syscoin && (
        <>
          {/* Burn Data */}
          {decodedTx.syscoin.burn && (
            <div className="bg-brand-blue800 rounded-lg p-4 space-y-2">
              <Typography.Text className="text-white text-sm block font-medium">
                Burn Data:
              </Typography.Text>
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
