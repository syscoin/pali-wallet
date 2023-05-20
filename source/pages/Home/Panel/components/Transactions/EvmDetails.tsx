import { uniqueId } from 'lodash';
import React, { Fragment, useEffect } from 'react';
import { useSelector } from 'react-redux';

import { Icon } from 'components/Icon';
import { IconButton } from 'components/IconButton';
import { Tooltip } from 'components/Tooltip';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { camelCaseToText, truncate } from 'utils/index';

export const EvmTransactionDetails = ({ hash }: { hash: string }) => {
  const { accounts, activeAccount } = useSelector(
    (state: RootState) => state.vault
  );
  const { transactions } = accounts[activeAccount.type][activeAccount.id];
  const { useCopyClipboard, alert } = useUtils();

  const [copied, copy] = useCopyClipboard();

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success('Hash successfully copied');
  }, [copied]);

  const formattedTransaction = [];

  transactions.find((tx: any) => {
    if (tx?.hash !== hash) return null;

    for (const [key, value] of Object.entries(tx)) {
      const formattedKey = camelCaseToText(key);
      const formattedBoolean = Boolean(value) ? 'Yes' : 'No';

      const formattedValue = {
        value: typeof value === 'boolean' ? formattedBoolean : value,
        label: formattedKey,
        canCopy: false,
      };

      if (String(value).length >= 20 && key !== 'image') {
        formattedValue.canCopy = true;
      }

      const isValid = typeof value !== 'object';

      if (isValid) formattedTransaction.push(formattedValue);
    }

    return formattedTransaction;
  });

  const RenderTransaction = () => (
    <>
      {formattedTransaction.map(({ label, value, canCopy }: any) => (
        <Fragment key={uniqueId(hash)}>
          {label.length > 0 && value !== undefined && (
            <li className="flex items-center justify-between my-1 pl-0 pr-3 py-2 w-full text-xs border-b border-dashed border-bkg-2 cursor-default transition-all duration-300">
              <p>{label}</p>
              <span>
                {value.length >= 20 ? (
                  <Tooltip content={value} childrenClassName="flex">
                    <b>{truncate(value, 20)}</b>
                    {canCopy && (
                      <IconButton onClick={() => copy(value ?? '')}>
                        <Icon
                          wrapperClassname="flex items-center justify-center"
                          name="copy"
                          className="px-1 text-brand-white hover:text-fields-input-borderfocus"
                        />
                      </IconButton>
                    )}
                  </Tooltip>
                ) : (
                  <b>{value}</b>
                )}
              </span>
            </li>
          )}
        </Fragment>
      ))}
    </>
  );

  return <RenderTransaction />;
};
