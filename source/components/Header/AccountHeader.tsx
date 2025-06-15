import { toSvg } from 'jdenticon';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import {
  IKeyringAccountState,
  KeyringAccountType,
} from '@pollum-io/sysweb3-keyring';

import {
  IconButton,
  Icon,
  Tooltip,
  ConfirmationModal,
  DefaultModal,
} from 'components/index';
import SkeletonLoader from 'components/Loader/SkeletonLoader';
import { useUtils } from 'hooks/index';
import { useAdjustedExplorer } from 'hooks/useAdjustedExplorer';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { ellipsis, adjustUrl } from 'utils/index';

export const AccountHeader: React.FC = () => {
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const {
    accounts,
    isBitcoinBased,
    activeNetwork,
    networkStatus,
    isSwitchingAccount,
  } = useSelector((state: RootState) => state.vault);
  const { useCopyClipboard, alert, navigate } = useUtils();
  const { t } = useTranslation();
  const [copied, copy] = useCopyClipboard();
  const [isLoading, setIsLoading] = useState(false);
  const [isOpenModal, setIsOpenModal] = useState(false);
  const [isReconectModalOpen, setIsReconectModalOpen] = useState(false);
  const { controllerEmitter } = useController();
  const isLedger = activeAccount.type === KeyringAccountType.Ledger;
  const url = chrome.runtime.getURL('app.html');

  const isNetworkChanging = networkStatus === 'switching';
  const adjustedExplorer = useAdjustedExplorer(activeNetwork.explorer);

  useEffect(() => {
    const placeholder = document.querySelector('.add-identicon');
    if (!placeholder || !accounts[activeAccount.type]?.[activeAccount.id])
      return;

    placeholder.innerHTML = toSvg(
      (accounts[activeAccount.type][activeAccount.id] as any)?.xpub,
      50,
      {
        backColor: '#07152B',
        padding: 1,
      }
    );
  }, [(accounts[activeAccount.type]?.[activeAccount.id] as any)?.address]);

  const editAccount = (account: IKeyringAccountState) => {
    navigate('/settings/edit-account', {
      state: account,
    });
  };

  const openAccountInExplorer = () => {
    const accountAddress = (
      accounts[activeAccount.type][activeAccount.id] as any
    )?.address;
    if (!accountAddress) return;

    let explorerUrl;
    if (isBitcoinBased) {
      // For UTXO networks, use the network URL pattern
      explorerUrl = `${adjustUrl(activeNetwork.url)}address/${accountAddress}`;
    } else {
      // For EVM networks, use the explorer pattern
      explorerUrl = `${adjustedExplorer}address/${accountAddress}`;
    }

    window.open(explorerUrl, '_blank');
  };

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.info(t('home.addressCopied'));
  }, [copied, alert, t]);

  const handleVerifyAddress = async () => {
    try {
      setIsLoading(true);

      // Use type assertion for legacy controller methods
      await (controllerEmitter as any)(
        ['wallet', 'ledgerSigner', 'utxo', 'verifyUtxoAddress'],
        [activeAccount.id, activeNetwork.currency, activeNetwork.slip44]
      );

      setIsLoading(false);

      setIsOpenModal(false);

      alert.success(t('home.addressVerified'));
    } catch (error: any) {
      const isNecessaryReconnect = error.message.includes(
        'read properties of undefined'
      );

      if (isNecessaryReconnect) {
        setIsReconectModalOpen(true);
        return;
      }

      const wasDeniedByUser = error?.message?.includes('denied by the user');

      if (wasDeniedByUser) {
        alert.error(t('home.verificationDeniedByUser'));
      }

      setIsOpenModal(false);

      setIsLoading(false);
    }
  };

  // Account data
  const currentAccount = accounts[activeAccount.type]?.[
    activeAccount.id
  ] as any;

  return (
    <div className="flex items-center justify-between p-1 bg-bkg-3">
      <ConfirmationModal
        title={t('home.verifySysAddress', {
          currency: activeNetwork.currency.toUpperCase(),
        })}
        description={t('home.verifySysAddressDescription', {
          currency: activeNetwork.currency.toUpperCase(),
        })}
        buttonText={t('buttons.verify')}
        onClick={handleVerifyAddress}
        onClose={() => setIsOpenModal(false)}
        show={isOpenModal}
        isButtonLoading={isLoading}
      />
      <DefaultModal
        show={isReconectModalOpen}
        title={t('settings.ledgerReconnection')}
        buttonText={t('buttons.reconnect')}
        description={t('settings.ledgerReconnectionMessage')}
        onClose={() => {
          setIsReconectModalOpen(false);
          window.open(`${url}?isReconnect=true`, '_blank');
        }}
      />
      <div className="flex ml-[15px] items-center w-full text-brand-white">
        <Tooltip content="View on Explorer">
          <div
            className="add-identicon ml-1 mr-2 my-2 cursor-pointer transition-all duration-200 hover:scale-105 hover:opacity-80 rounded-full"
            onClick={openAccountInExplorer}
            title="View account on explorer"
          />
        </Tooltip>

        <div className="items-center justify-center px-1 text-brand-white">
          {isNetworkChanging || isSwitchingAccount ? (
            <SkeletonLoader width="150px" height="20px" />
          ) : (
            <p
              className="mb-1 text-base font-medium"
              id="active-account-label items-center"
            >
              {currentAccount?.label}
              <IconButton
                onClick={() => editAccount(currentAccount)}
                type="primary"
                shape="circle"
              >
                <Icon
                  name="edit"
                  className="hover:text-brand-royalblue text-xs ml-1 flex justify-center w-4 h-4"
                />
              </IconButton>
            </p>
          )}
          {isNetworkChanging || isSwitchingAccount ? (
            <SkeletonLoader width="200px" height="15px" margin="5px 0 0 0" />
          ) : (
            <div className="flex items-center">
              <Tooltip
                content={
                  isLedger && isBitcoinBased && activeNetwork.chainId === 57
                    ? t('home.clickToVerify', {
                        currency: activeNetwork.currency.toUpperCase(),
                      })
                    : ''
                }
              >
                <p
                  className={`text-xs ${
                    isLedger && isBitcoinBased && activeNetwork.chainId === 57
                      ? 'cursor-pointer'
                      : ''
                  }`}
                  onClick={() => {
                    if (
                      isLedger &&
                      isBitcoinBased &&
                      activeNetwork.chainId === 57
                    )
                      setIsOpenModal(true);
                  }}
                >
                  {ellipsis(currentAccount?.address, 6, 14)}
                </p>
              </Tooltip>
              <IconButton
                onClick={() => copy(currentAccount?.address ?? '')}
                type="primary"
                shape="circle"
                className="ml-2"
              >
                <Icon
                  name="copy"
                  className="text-xs hover:text-brand-royalblue"
                  id="copy-address-btn"
                />
              </IconButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
