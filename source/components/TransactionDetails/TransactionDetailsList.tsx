import React, { Fragment } from 'react';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { Tooltip } from 'components/Tooltip';
import { ellipsis } from 'utils/index';

interface ITransactionDetailsListProps {
  details: Array<{
    canCopy?: boolean;
    className?: string;
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
    className="px-1 text-brand-white hover:text-fields-input-borderfocus"
  />
));
CopyIcon.displayName = 'CopyIcon';

export const TransactionDetailsList: React.FC<ITransactionDetailsListProps> = ({
  details,
  onCopy,
}) => (
  <>
    {details.map(
      ({ label, value, canCopy, className, tooltip }: any, index: number) => (
        <Fragment key={`detail-${index}`}>
          {label.length > 0 && value !== undefined && (
            <div className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-[#FFFFFF29] cursor-default transition-all duration-300">
              <p className="text-xs font-normal text-white">{label}</p>
              <span className={className || ''}>
                {String(value).length >= 20 ? (
                  <Tooltip content={value} childrenClassName="flex">
                    <p
                      className={`text-xs font-normal ${
                        className || 'text-white'
                      }`}
                    >
                      {ellipsis(String(value), 2, 4)}
                    </p>
                    {canCopy && (
                      <IconButton onClick={() => onCopy(value ?? '', label)}>
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
                      {value}
                    </p>
                    {canCopy && (
                      <IconButton onClick={() => onCopy(tooltip ?? '', label)}>
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
                    {value}
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
