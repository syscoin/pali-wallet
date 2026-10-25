import React, { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { Tooltip } from 'components/Tooltip';
import { ellipsis } from 'utils/index';
import { translateTransactionLabel } from 'utils/transactionDisplay';

interface ITransactionDetailsListProps {
  details: Array<{
    canCopy?: boolean;
    className?: string;
    copyValue?: string;
    label: string;
    tooltip?: string;
    value: any; // optional tooltip content for short values (e.g., ENS -> address)
  }>;
  onCopy: (value: string, label: string) => void;
}

// Memoize copy icon to prevent unnecessary re-renders
const CopyIcon = React.memo(() => (
  <Icon
    wrapperClassname="flex items-center justify-center"
    name="copy"
    className="px-1 text-brand-white hover:text-content-accent"
  />
));
CopyIcon.displayName = 'CopyIcon';

export const TransactionDetailsList: React.FC<ITransactionDetailsListProps> = ({
  details,
  onCopy,
}) => {
  const { t } = useTranslation();
  return (
    <>
      {details.map(
        (
          { label, value, canCopy, className, tooltip, copyValue }: any,
          index: number
        ) => (
          <Fragment key={`detail-${index}`}>
            {label.length > 0 && value !== undefined && (
              <div className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-[#FFFFFF29] cursor-default transition-all duration-300">
                <p className="text-xs font-normal text-white">
                  {translateTransactionLabel(label, t)}
                </p>
                <span className={className || ''}>
                  {String(value).length >= 20 ? (
                    <Tooltip
                      content={tooltip ?? value}
                      childrenClassName="flex"
                      focusable
                    >
                      <p
                        className={`text-xs font-normal ${
                          className || 'text-white'
                        }`}
                      >
                        {ellipsis(String(value), 2, 4)}
                      </p>
                      {canCopy && (
                        <IconButton
                          aria-label={`${t(
                            'buttons.copy'
                          )}: ${translateTransactionLabel(label, t)}`}
                          onClick={() =>
                            onCopy(copyValue ?? value ?? '', label)
                          }
                        >
                          <CopyIcon />
                        </IconButton>
                      )}
                    </Tooltip>
                  ) : tooltip ? (
                    <Tooltip content={tooltip} childrenClassName="flex">
                      <p
                        className={`text-xs font-normal ${
                          className || 'text-white'
                        }`}
                      >
                        {value === null || value === ''
                          ? t('components.notAvailable')
                          : label === 'Success' &&
                            (value === 'Success' || value === 'Failed')
                          ? t(
                              value === 'Success'
                                ? 'buttons.success'
                                : 'send.failed'
                            )
                          : value}
                      </p>
                      {canCopy && (
                        <IconButton
                          aria-label={`${t(
                            'buttons.copy'
                          )}: ${translateTransactionLabel(label, t)}`}
                          onClick={() =>
                            onCopy(copyValue ?? value ?? '', label)
                          }
                        >
                          <CopyIcon />
                        </IconButton>
                      )}
                    </Tooltip>
                  ) : (
                    <p
                      className={`text-xs font-normal ${
                        className || 'text-white'
                      }`}
                    >
                      {value === null || value === ''
                        ? t('components.notAvailable')
                        : label === 'Success' &&
                          (value === 'Success' || value === 'Failed')
                        ? t(
                            value === 'Success'
                              ? 'buttons.success'
                              : 'send.failed'
                          )
                        : value}
                    </p>
                  )}
                </span>
              </div>
            )}
          </Fragment>
        )
      )}
    </>
  );
};
