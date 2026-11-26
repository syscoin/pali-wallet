import { Menu } from '@headlessui/react';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from 'components/Icon';
import { ExternalLinkSvg, TrashIconSvg } from 'components/Icon/Icon';

export function TransactionOptionsMenu({
  children,
  id,
  onDetails,
  onExplorer,
  pending,
}: {
  children?: React.ReactNode;
  id?: string;
  onDetails: () => void;
  onExplorer?: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  return (
    <Menu id={id} as="div" className="relative inline-block text-left">
      {({ open }) => (
        <>
          <Menu.Button
            aria-label={t('transactions.transactionOptions')}
            className="inline-flex justify-center w-full hover:text-button-primaryhover text-white text-sm font-medium hover:bg-opacity-30 rounded-full w-5"
          >
            <Icon isSvg name="EditTx" className="text-base" />
          </Menu.Button>
          <div className="absolute right-0 z-10 h-[15rem]">
            {open && (
              <Menu.Items
                as="div"
                className="p-4 absolute right-0 z-10 w-[23rem] origin-top-right rounded-lg bg-brand-blue500 shadow-2xl ring-1 max-w-[calc(100vw-2rem)] font-poppins ring-black ring-opacity-5 focus:outline-none transition-all duration-100 ease-out transform opacity-100 scale-100 pointer-events-auto"
              >
                {pending && (
                  <h1 className="text-sm font-semibold text-brand-gray200 pb-2 px-2">
                    {t('transactions.pendingTransaction')}
                  </h1>
                )}
                <TransactionOptionsMenuItem icon="link" onClick={onDetails}>
                  {t('transactions.seeDetails')}
                </TransactionOptionsMenuItem>
                {onExplorer && (
                  <TransactionOptionsMenuItem icon="link" onClick={onExplorer}>
                    {t('transactions.seeOnBlockExplorer')}
                  </TransactionOptionsMenuItem>
                )}
                {children}
              </Menu.Items>
            )}
          </div>
        </>
      )}
    </Menu>
  );
}

export function TransactionOptionsMenuItem({
  children,
  disabled,
  icon,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  icon: 'link' | 'speed-up' | 'cancel';
  onClick: () => void;
}) {
  return (
    <Menu.Item disabled={disabled}>
      {({ active }) => (
        <button
          type="button"
          className={`mb-2 flex w-full items-center justify-start rounded-md p-2 text-sm text-brand-white transition-all duration-150 last:mb-0 hover:bg-brand-blue400 hover:bg-opacity-30 ${
            active ? 'bg-brand-blue400 bg-opacity-50' : ''
          }`}
          onClick={onClick}
        >
          <span aria-hidden="true" className="mr-3 w-5">
            {icon === 'link' ? (
              <ExternalLinkSvg className="text-base text-brand-white" />
            ) : icon === 'speed-up' ? (
              <Icon
                name="SpeedUp"
                isSvg
                className="text-base text-brand-white"
              />
            ) : (
              <TrashIconSvg className="text-base text-brand-white" />
            )}
          </span>
          {children}
        </button>
      )}
    </Menu.Item>
  );
}
