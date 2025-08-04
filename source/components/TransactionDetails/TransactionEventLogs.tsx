import React from 'react';
import { useTranslation } from 'react-i18next';

import { ellipsis } from 'utils/index';

interface ITransactionEventLogsProps {
  className?: string;
  logs: any[];
}

export const TransactionEventLogs: React.FC<ITransactionEventLogsProps> = ({
  logs,
  className = '',
}) => {
  const { t } = useTranslation();

  if (!logs || logs.length === 0) {
    return null;
  }

  return (
    <div className={`mt-4 ${className}`}>
      <p className="text-sm font-semibold text-white mb-2">
        {t('transactions.eventLogs')} ({logs.length})
      </p>
      <div className="max-h-40 overflow-y-auto">
        {logs.map((log: any, index: number) => (
          <div key={index} className="mb-2 p-2 bg-bkg-2 rounded text-xs">
            <p className="text-brand-gray200">
              {t('transactions.log')} #{index + 1}
            </p>
            <p className="text-white break-all">
              {t('send.address')}: {ellipsis(log.address, 6, 4)}
            </p>
            {log.topics && log.topics.length > 0 && (
              <p className="text-white break-all mt-1">
                {t('transactions.topics')}: {log.topics.length}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
