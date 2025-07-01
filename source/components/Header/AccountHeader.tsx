import { toSvg } from 'jdenticon';
import React, { useEffect, useState, useCallback, useMemo } from 'react';
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
import { selectActiveAccount } from 'state/vault/selectors';
import { ellipsis, adjustUrl } from 'utils/index';

export const AccountHeader: React.FC = () => {
  const currentAccount = useSelector(selectActiveAccount);
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const networkStatus = useSelector(
    (state: RootState) => state.vaultGlobal.networkStatus
  );
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const { useCopyClipboard, alert, navigate } = useUtils();
  const { t } = useTranslation();
  const { controllerEmitter } = useController();
  const [copied, copy] = useCopyClipboard();
  const [isLoading, setIsLoading] = useState(false);
  const [isOpenModal, setIsOpenModal] = useState(false);
  const [isReconectModalOpen, setIsReconectModalOpen] = useState(false);

  const isLedger = useMemo(
    () => activeAccount?.type === KeyringAccountType.Ledger,
    [activeAccount?.type]
  );

  const isNetworkChanging = useMemo(
    () => networkStatus === 'switching',
    [networkStatus]
  );

  const url = useMemo(() => chrome.runtime.getURL('app.html'), []);

  const adjustedExplorer = useAdjustedExplorer(activeNetwork.explorer);

  const editAccount = useCallback(
    (account: IKeyringAccountState) => {
      navigate('/settings/edit-account', {
        state: account,
      });
    },
    [navigate]
  );

  const openAccountInExplorer = useCallback(() => {
    const accountAddress = currentAccount?.address;
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
  }, [
    currentAccount?.address,
    isBitcoinBased,
    activeNetwork.url,
    adjustedExplorer,
  ]);

  const handleVerifyAddress = useCallback(async () => {
    try {
      setIsLoading(true);

      // Use type assertion for legacy controller methods
      await (controllerEmitter as any)(
        ['wallet', 'ledgerSigner', 'utxo', 'verifyUtxoAddress'],
        [activeAccount?.id, activeNetwork.currency, activeNetwork.slip44]
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
  }, [
    controllerEmitter,
    activeAccount?.id,
    activeNetwork.currency,
    activeNetwork.slip44,
    alert,
    t,
  ]);

  const handleCloseReconnectModal = useCallback(() => {
    setIsReconectModalOpen(false);
    window.open(`${url}?isReconnect=true`, '_blank');
  }, [url]);

  const handleLedgerAddressClick = useCallback(() => {
    if (isLedger && isBitcoinBased && activeNetwork.chainId === 57) {
      setIsOpenModal(true);
    }
  }, [isLedger, isBitcoinBased, activeNetwork.chainId]);

  const copyAddress = useCallback(() => {
    copy(currentAccount?.address ?? '');
  }, [copy, currentAccount?.address]);

  useEffect(() => {
    const placeholder = document.querySelector('.add-identicon');
    if (!placeholder || !currentAccount?.xpub) return;

    placeholder.innerHTML = toSvg(currentAccount.xpub, 50, {
      backColor: '#07152B',
      padding: 1,
    });
  }, [currentAccount?.xpub]);

  useEffect(() => {
    if (!copied) return;

    alert.info(t('home.addressCopied'));
  }, [copied, alert, t]);

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
        onClose={handleCloseReconnectModal}
      />
      <div className="flex ml-[15px] items-center w-full text-brand-white">
        <Tooltip content={t('home.viewOnExplorer')}>
          <div
            className="add-identicon ml-1 mr-2 my-2 cursor-pointer transition-all duration-200 hover:scale-105 hover:opacity-80 rounded-full"
            onClick={openAccountInExplorer}
            title={t('home.viewAccountOnExplorer')}
          />
        </Tooltip>

        <div className="items-center justify-center px-1 text-brand-white">
          {isNetworkChanging ? (
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
          {isNetworkChanging ? (
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
                  onClick={handleLedgerAddressClick}
                >
                  {ellipsis(currentAccount?.address, 6, 14)}
                </p>
              </Tooltip>
              <IconButton
                onClick={copyAddress}
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
