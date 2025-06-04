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
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { ellipsis } from 'utils/index';

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

  useEffect(() => {
    const placeholder = document.querySelector('.add-identicon');
    if (!placeholder) return;

    placeholder.innerHTML = toSvg(
      accounts[activeAccount.type][activeAccount.id]?.xpub,
      50,
      {
        backColor: '#07152B',
        padding: 1,
      }
    );
  }, [accounts[activeAccount.type][activeAccount.id]?.address]);

  const editAccount = (account: IKeyringAccountState) => {
    navigate('/settings/edit-account', {
      state: account,
    });
  };

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.info(t('home.addressCopied'));
  }, [copied, alert, t]);

  const handleVerifyAddress = async () => {
    try {
      setIsLoading(true);

      await controllerEmitter(
        ['wallet', 'ledgerSigner', 'utxo', 'verifyUtxoAddress'],
        [activeAccount.id]
      );

      setIsLoading(false);

      setIsOpenModal(false);

      alert.success(t('home.addressVerified'));
    } catch (error) {
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

  return (
    <div className="flex items-center justify-between p-1 bg-bkg-3">
      <ConfirmationModal
        title={t('home.verifySysAddress')}
        description={t('home.verifySysAddressDescription')}
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
        <div className="add-identicon ml-1 mr-2 my-2" />

        <div className="items-center justify-center px-1 text-brand-white">
          {isNetworkChanging || isSwitchingAccount ? (
            <SkeletonLoader width="150px" height="20px" />
          ) : (
            <p
              className="mb-1 text-base font-medium"
              id="active-account-label items-center"
            >
              {accounts[activeAccount.type][activeAccount.id]?.label}
              <IconButton
                onClick={() =>
                  editAccount(accounts[activeAccount.type][activeAccount.id])
                }
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
                    ? t('home.clickToVerify')
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
                  {ellipsis(
                    accounts[activeAccount.type][activeAccount.id]?.address,
                    6,
                    14
                  )}
                </p>
              </Tooltip>
              <IconButton
                onClick={() =>
                  copy(
                    accounts[activeAccount.type][activeAccount.id]?.address ??
                      ''
                  )
                }
                type="primary"
                shape="circle"
                className="ml-2"
              >
                <Icon name="copy" className="text-xs" id="copy-address-btn" />
              </IconButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
