import { Dialog } from '@headlessui/react';
import { isHexString } from 'ethers/lib/utils';
import { toSvg } from 'jdenticon';
import React, {
  useCallback,
  useEffect,
  useState,
  useRef,
  useMemo,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

import { LoadingSvg } from 'components/Icon/Icon';
import {
  PrimaryButton,
  SecondaryButton,
  Icon,
  Modal,
  Tooltip,
  IconButton,
} from 'components/index';
import trustedApps from 'constants/trustedApps.json';
import { useQueryData, useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { usePrice } from 'hooks/usePrice';
import { RootState } from 'state/store';
import { selectAccountAssets } from 'state/vault/selectors';
import { dispatchBackgroundEvent } from 'utils/browser';
import { ellipsis, formatNumber } from 'utils/index';

// Component to render account icon matching the app's pattern - moved outside to prevent recreation
const AccountIcon = React.memo(
  ({ account, size = 40 }: { account: any; size?: number }) => {
    const iconRef = useRef<HTMLDivElement>(null);

    // Extract identifier to avoid object reference issues
    const identifier = account?.xpub || account?.address || '';

    useEffect(() => {
      if (!iconRef.current || !identifier) return;

      iconRef.current.innerHTML = toSvg(identifier, size, {
        backColor: '#07152B',
        padding: 1,
      });
    }, [identifier, size]); // Depend on the extracted identifier string

    return (
      <div
        ref={iconRef}
        className="add-identicon rounded-full overflow-hidden cursor-pointer transition-all duration-200 hover:scale-105 hover:opacity-80"
        style={{ width: size, height: size }}
      />
    );
  }
);
AccountIcon.displayName = 'AccountIcon';

export const ConnectWallet = () => {
  const { controllerEmitter } = useController();
  const { host, chain, chainId, eventName } = useQueryData();
  const { t } = useTranslation();
  const accounts = useSelector((state: RootState) => state.vault.accounts);
  const { activeAccount: activeAccountData, activeNetwork } = useSelector(
    (state: RootState) => state.vault
  );
  const { id, type } = activeAccountData;
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const accountAssets = useSelector(selectAccountAssets);
  const { getFiatAmount } = usePrice();
  const { useCopyClipboard, alert } = useUtils();
  const [, copy] = useCopyClipboard();

  const [currentAccountId, setCurrentAccountId] = useState<number>();
  const [currentAccountType, setCurrentAccountType] =
    useState<KeyringAccountType>();

  const [accountId, setAccountId] = useState<number>();
  const [accountType, setAccountType] = useState<KeyringAccountType>();
  const [confirmUntrusted, setConfirmUntrusted] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const date = Date.now();

  // Get balance for an account - memoized to prevent recreation
  const getAccountBalance = useCallback(
    (account: any, accType: string) => {
      // Get native currency balance from account.balances
      const nativeBalance = isBitcoinBased
        ? account.balances?.syscoin || 0
        : account.balances?.ethereum || 0;

      // Format balance with appropriate decimals
      const formattedBalance =
        nativeBalance > 0 ? formatNumber(nativeBalance.toString(), 4) : '0';

      // Get fiat value
      const fiatValue =
        nativeBalance > 0 ? getFiatAmount(nativeBalance, 4) : '$0.00';

      // Count tokens from accountAssets (excluding native currency)
      const assets = accountAssets[accType]?.[account.id];
      const allAssets = isBitcoinBased ? assets?.syscoin : assets?.ethereum;
      const tokenCount = Array.isArray(allAssets)
        ? allAssets.filter(
            (asset: any) => asset.contractAddress && asset.balance > 0
          ).length
        : 0;

      return { balance: formattedBalance, fiatValue, tokenCount };
    },
    [accountAssets, isBitcoinBased, getFiatAmount]
  );

  const handleConnect = useCallback(async () => {
    // Find the selected account
    const selectedAccount = accounts[accountType]?.[accountId];
    if (!selectedAccount) {
      console.error('[ConnectWallet] Selected account not found');
      return;
    }

    await controllerEmitter(
      ['dapp', 'connect'],
      [{ host, chain, chainId, accountId, accountType, date }]
    );

    await controllerEmitter(['wallet', 'setAccount'], [accountId, accountType]);

    dispatchBackgroundEvent(`${eventName}.${host}`, selectedAccount.address);

    window.close();
  }, [
    host,
    chain,
    chainId,
    accountId,
    accountType,
    date,
    accounts,
    controllerEmitter,
    eventName,
  ]);

  const onConfirm = () => {
    // Check if the host is in the trusted apps list
    const isTrusted = trustedApps.some((trustedHost) =>
      host.toLowerCase().includes(trustedHost.toLowerCase())
    );

    if (isTrusted) {
      handleConnect();
    } else {
      setConfirmUntrusted(true);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const dapp: any = await controllerEmitter(['dapp', 'get'], [host]);

        if (dapp) {
          setCurrentAccountId(dapp?.accountId);
          setCurrentAccountType(dapp?.accountType);

          // Set the connected account as selected by default
          setAccountId(dapp?.accountId);
          setAccountType(dapp?.accountType);
        } else {
          // If no existing connection, select the active account by default
          setAccountId(id);
          setAccountType(type);
        }
      } catch (error) {
        console.error('[ConnectWallet] Error fetching dapp data:', error);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [host, controllerEmitter, id, type]);

  // Remove the auto-close effect - let user make the choice

  // Get the currently connected account info
  const connectedAccount =
    currentAccountId !== undefined && currentAccountType !== undefined
      ? accounts[currentAccountType]?.[currentAccountId]
      : null;

  // Memoize filtered accounts to prevent recomputation
  const filteredAccounts = useMemo(() => {
    if (!accounts) return [];

    return Object.entries(accounts)
      .map(([keyringAccountType, accountList]) => {
        const isValidAccount = (currentAccount: any) =>
          isBitcoinBased
            ? !isHexString(currentAccount.address)
            : isHexString(currentAccount.address);

        const validAccounts = Object.values(accountList).filter(isValidAccount);

        return {
          type: keyringAccountType,
          accounts: validAccounts,
        };
      })
      .filter(
        ({ accounts: keyringAccountsList }) => keyringAccountsList.length > 0
      );
  }, [accounts, isBitcoinBased]);

  return (
    <div className="flex flex-col w-full h-full">
      {/* Main scrollable content area */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <LoadingSvg className="w-8 h-8 text-brand-royalblue animate-spin" />
          </div>
        ) : accounts && Object.keys(accounts).length > 0 ? (
          <>
            {/* Header section */}
            <div className="text-center px-6 py-6 border-b border-brand-gray300">
              <h3 className="text-xs text-brand-graylight uppercase tracking-wider mb-2">
                Connect Request
              </h3>
              <div className="flex items-center justify-center gap-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-royalblue to-brand-deepPurple flex items-center justify-center">
                  <Icon name="link" className="text-white" size={16} />
                </div>
                <p className="text-lg font-medium text-brand-white">{host}</p>
              </div>

              {connectedAccount && (
                <div className="mt-3 p-2 bg-bkg-4 rounded-lg">
                  <p className="text-xs text-brand-graylight">
                    Currently connected to:{' '}
                    <span className="text-brand-white font-medium">
                      {connectedAccount.label}
                    </span>
                  </p>
                  <p className="text-[10px] text-brand-graylight mt-1">
                    Selecting a different account will switch the connection
                  </p>
                </div>
              )}
            </div>

            {/* Accounts list */}
            <div className="px-4 py-4">
              <div className="space-y-4">
                {filteredAccounts.map(
                  ({ type: keyringType, accounts: keyringAccounts }) => (
                    <div key={keyringType}>
                      <h4 className="text-xs font-medium text-brand-graylight uppercase tracking-wider mb-3 px-2">
                        {keyringType === KeyringAccountType.HDAccount
                          ? 'HD Account'
                          : keyringType === KeyringAccountType.Imported
                          ? 'Imported'
                          : keyringType}
                      </h4>
                      <div className="space-y-2">
                        {keyringAccounts.map((acc) => {
                          const isSelected =
                            acc.id === accountId && accountType === keyringType;
                          const { balance, fiatValue, tokenCount } =
                            getAccountBalance(acc, keyringType);

                          return (
                            <div
                              key={`${acc.id}-${type}`}
                              className={`w-full p-4 rounded-lg border transition-all duration-200 text-left group cursor-pointer
                                ${
                                  isSelected
                                    ? 'border-brand-royalblue bg-bkg-4 shadow-md'
                                    : 'border-brand-gray300 bg-bkg-2 hover:bg-bkg-3 hover:border-brand-gray200'
                                }`}
                              role="button"
                              tabIndex={0}
                              onClick={() => {
                                setAccountId(acc.id);
                                setAccountType(
                                  keyringType as KeyringAccountType
                                );
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setAccountId(acc.id);
                                  setAccountType(
                                    keyringType as KeyringAccountType
                                  );
                                }
                              }}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
                                  <div className="relative">
                                    <AccountIcon account={acc} size={40} />
                                  </div>
                                  <div className="flex-1 min-w-0 pr-3">
                                    <p className="font-medium text-sm text-brand-white mb-1 truncate">
                                      {acc.label}
                                    </p>
                                    <div className="flex items-center gap-1">
                                      <Tooltip
                                        content={acc.address}
                                        placement="top"
                                      >
                                        <p className="text-xs text-brand-graylight truncate">
                                          {ellipsis(acc.address, 15, 4)}
                                        </p>
                                      </Tooltip>
                                      <div
                                        onClick={(e) => e.stopPropagation()}
                                        className="inline-flex flex-shrink-0"
                                      >
                                        <IconButton
                                          type="primary"
                                          shape="circle"
                                          onClick={() => {
                                            copy(acc.address);
                                            alert.info(t('home.addressCopied'));
                                          }}
                                          className="opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                                        >
                                          <Icon
                                            name="copy"
                                            className="text-xs hover:text-brand-royalblue"
                                            size={10}
                                          />
                                        </IconButton>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center gap-3 flex-shrink-0">
                                  <div className="text-right min-w-[100px]">
                                    <p className="text-sm font-medium text-brand-white">
                                      {balance}{' '}
                                      {activeNetwork.currency?.toUpperCase() ||
                                        'SYS'}
                                    </p>
                                    <p className="text-xs text-brand-graylight">
                                      {fiatValue}
                                    </p>
                                    {tokenCount > 0 && (
                                      <p className="text-xs text-brand-royalblue mt-0.5">
                                        +{tokenCount}{' '}
                                        {tokenCount === 1 ? 'token' : 'tokens'}
                                      </p>
                                    )}
                                  </div>
                                  <div
                                    className={`w-6 h-6 rounded-full border-2 transition-all duration-200 flex-shrink-0 flex items-center justify-center
                                    ${
                                      isSelected
                                        ? 'bg-brand-royalblue border-brand-royalblue'
                                        : 'bg-transparent border-brand-gray300 group-hover:border-brand-royalblue'
                                    }`}
                                  >
                                    {isSelected && (
                                      <div className="flex items-center justify-center w-full h-full relative">
                                        <Icon
                                          name="check"
                                          className="text-white absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
                                          size={12}
                                        />
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )
                )}
              </div>

              {/* Info message with proper spacing from buttons */}
              <div className="mt-6 mb-4 px-2">
                <p className="text-xs text-center text-brand-graylight">
                  {t('connections.onlyConnect')}{' '}
                  <a
                    href="https://docs.syscoin.org/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-royalblue hover:underline"
                  >
                    {t('connections.learnMore')}
                  </a>
                </p>
              </div>
            </div>

            {/* Add bottom padding to account for fixed buttons */}
            <div className="pb-20"></div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-brand-graylight">No accounts available</p>
          </div>
        )}
      </div>

      {/* Fixed button container at bottom of viewport */}
      <div className="fixed bottom-0 left-0 right-0 bg-bkg-3 border-t border-brand-gray300 px-4 py-3 shadow-lg z-50">
        <div className="flex gap-3 justify-center">
          <SecondaryButton type="button" onClick={() => window.close()}>
            {t('buttons.cancel')}
          </SecondaryButton>

          <PrimaryButton
            type="button"
            disabled={accountId === undefined || accountType === undefined}
            onClick={onConfirm}
          >
            {t('buttons.confirm')}
          </PrimaryButton>
        </div>
      </div>

      <Modal show={confirmUntrusted} onClose={() => setConfirmUntrusted(false)}>
        <div className="inline-block align-middle my-8 p-6 w-full max-w-2xl text-center font-poppins bg-bkg-4 border border-brand-royalblue rounded-2xl shadow-xl overflow-hidden transform transition-all">
          <Dialog.Title
            as="h3"
            className="flex gap-3 items-center justify-center text-brand-white text-lg font-medium leading-6"
          >
            <Icon name="warning" className="mb-2 text-brand-white" />
            <p>{t('connections.nonTrusted')}</p>
          </Dialog.Title>

          <div className="mt-4">
            <p className="text-brand-white text-sm">
              {t('connections.nonTrustedMessage')}
            </p>
          </div>

          <div className="flex gap-5 items-center justify-between mt-8">
            <SecondaryButton
              width="36"
              type="button"
              onClick={() => setConfirmUntrusted(false)}
            >
              {t('buttons.cancel')}
            </SecondaryButton>

            <PrimaryButton width="36" type="button" onClick={handleConnect}>
              {t('buttons.confirm')}
            </PrimaryButton>
          </div>
        </div>
      </Modal>
    </div>
  );
};
