import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from 'components/index';
import { useQueryData } from 'hooks/index';
import { dispatchBackgroundEvent } from 'utils/browser';
import { ellipsis } from 'utils/format';
import { clearNavigationState } from 'utils/navigationState';
import {
  CALLS_STATUS_CONFIRMED,
  CALLS_STATUS_PARTIALLY_REVERTED,
  CALLS_STATUS_PENDING,
  CALLS_STATUS_REVERTED,
} from 'utils/sendCallsBatch';

interface ICallsStatusReceipt {
  blockHash: string;
  blockNumber: string;
  gasUsed: string;
  logs: Array<{ address: string; data: string; topics: string[] }>;
  status: '0x0' | '0x1';
  transactionHash: string;
}

interface ICallsStatusData {
  callsStatus: {
    atomic: boolean;
    chainId: string;
    id: string;
    receipts?: ICallsStatusReceipt[];
    status: number;
    version: string;
  };
  eventName: string;
  host: string;
}

// Read-only EIP-5792 wallet_showCallsStatus popup: displays the resolved
// bundle status. The RPC method itself returns nothing, so the request is
// resolved as soon as the popup has rendered; the user closes it manually.
export const CallsStatus: React.FC = () => {
  const { t } = useTranslation();
  const { callsStatus, eventName, host } = useQueryData() as ICallsStatusData;
  const resolvedRef = useRef(false);

  useEffect(() => {
    if (resolvedRef.current || !eventName || !host) {
      return;
    }
    resolvedRef.current = true;
    dispatchBackgroundEvent(`${eventName}.${host}`, null);
  }, [eventName, host]);

  const statusLabel = (() => {
    switch (callsStatus?.status) {
      case CALLS_STATUS_PENDING:
        return t('send.pending');
      case CALLS_STATUS_CONFIRMED:
        return t('send.confirmed');
      case CALLS_STATUS_REVERTED:
        return t('send.reverted');
      case CALLS_STATUS_PARTIALLY_REVERTED:
        return t('send.partiallyReverted');
      default:
        return String(callsStatus?.status ?? '');
    }
  })();

  const statusColor =
    callsStatus?.status === CALLS_STATUS_CONFIRMED
      ? 'text-brand-green'
      : callsStatus?.status === CALLS_STATUS_PENDING
      ? 'text-brand-yellowAccent'
      : 'text-brand-red';

  const handleClose = () => {
    clearNavigationState();
    window.close();
  };

  if (!callsStatus) {
    return null;
  }

  return (
    <div className="h-screen flex flex-col">
      <div className="bg-brand-blue600 p-4">
        <h1 className="text-brand-white text-base font-medium">
          {t('send.batchStatus')}
        </h1>
        <p className="text-brand-gray200 text-xs mt-1">{host}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="bg-bkg-3 rounded-lg p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-brand-gray200">{t('send.status')}</span>
            <span className={`font-medium ${statusColor}`}>
              {statusLabel} ({callsStatus.status})
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-brand-gray200">Chain ID</span>
            <span className="text-brand-white">{callsStatus.chainId}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-brand-gray200">
              {t('send.batchTransaction')}
            </span>
            <span className="text-brand-white">
              {callsStatus.atomic ? 'atomic' : 'sequential'}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-brand-gray200">ID</span>
            <span className="text-brand-white" title={callsStatus.id}>
              {ellipsis(callsStatus.id, 10, 6)}
            </span>
          </div>
        </div>

        {(callsStatus.receipts || []).length > 0 && (
          <div className="space-y-2">
            <h2 className="text-brand-gray200 text-sm">{t('send.receipts')}</h2>
            {callsStatus.receipts.map((receipt) => (
              <div
                key={receipt.transactionHash}
                className="bg-bkg-3 rounded-lg p-3 space-y-1 text-xs"
              >
                <div className="flex justify-between">
                  <span className="text-brand-gray200">Tx</span>
                  <span
                    className="text-brand-white"
                    title={receipt.transactionHash}
                  >
                    {ellipsis(receipt.transactionHash, 10, 6)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-brand-gray200">{t('send.status')}</span>
                  <span
                    className={
                      receipt.status === '0x1'
                        ? 'text-brand-green'
                        : 'text-brand-red'
                    }
                  >
                    {receipt.status === '0x1'
                      ? t('send.confirmed')
                      : t('send.reverted')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-brand-gray200">Block</span>
                  <span className="text-brand-white">
                    {parseInt(receipt.blockNumber, 16)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-brand-gray200">Gas</span>
                  <span className="text-brand-white">
                    {parseInt(receipt.gasUsed, 16)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="p-4">
        <Button
          variant="secondary"
          type="button"
          fullWidth
          onClick={handleClose}
        >
          {t('buttons.close')}
        </Button>
      </div>
    </div>
  );
};
