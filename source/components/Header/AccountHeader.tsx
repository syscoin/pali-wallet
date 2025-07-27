import { toSvg } from 'jdenticon';
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { IconButton, Icon, Tooltip, ConfirmationModal } from 'components/index';
import SkeletonLoader from 'components/Loader/SkeletonLoader';
import { useUtils } from 'hooks/index';
import { useAdjustedExplorer } from 'hooks/useAdjustedExplorer';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectActiveAccount } from 'state/vault/selectors';
import { IKeyringAccountState, KeyringAccountType } from 'types/network';
import { ellipsis, adjustUrl } from 'utils/index';
import { isUserCancellationError } from 'utils/isUserCancellationError';
import {
  createNavigationContext,
  navigateWithContext,
} from 'utils/navigationState';

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

  const isLedger = useMemo(
    () => activeAccount?.type === KeyringAccountType.Ledger,
    [activeAccount?.type]
  );

  const isTrezor = useMemo(
    () => activeAccount?.type === KeyringAccountType.Trezor,
    [activeAccount?.type]
  );

  const isNetworkChanging = useMemo(
    () => networkStatus === 'switching',
    [networkStatus]
  );

  const adjustedExplorer = useAdjustedExplorer(activeNetwork.explorer);

  const editAccount = useCallback(
    (account: IKeyringAccountState) => {
      const returnContext = createNavigationContext('/home');
      navigateWithContext(
        navigate,
        '/settings/edit-account',
        account,
        returnContext
      );
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

      // Determine which hardware wallet type to use
      const signerType = isLedger ? 'ledgerSigner' : 'trezorSigner';

      // Use type assertion for legacy controller methods
      await (controllerEmitter as any)(
        ['wallet', signerType, 'utxo', 'verifyUtxoAddress'],
        [activeAccount?.id, activeNetwork.currency, activeNetwork.slip44],
        false,
        300000 // 5 minutes timeout for hardware wallet operations
      );

      setIsLoading(false);
      setIsOpenModal(false);
      alert.success(t('home.addressVerified'));
    } catch (error: any) {
      // Handle user cancellation - show specific message
      if (isUserCancellationError(error)) {
        alert.error(t('home.verificationDeniedByUser'));
      } else {
        // For any other errors, show a generic error message
        alert.error(t('send.verificationFailed'));
      }

      setIsOpenModal(false);
      setIsLoading(false);
    }
  }, [
    activeAccount?.id,
    activeNetwork.currency,
    activeNetwork.slip44,
    alert,
    t,
    isLedger,
  ]);

  const handleHardwareAddressClick = useCallback(() => {
    if ((isLedger || isTrezor) && isBitcoinBased) {
      setIsOpenModal(true);
    }
  }, [isLedger, isTrezor, isBitcoinBased]);

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
    <div className="relative z-[55] flex items-center justify-between p-1 bg-bkg-3">
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
                  (isLedger || isTrezor) && isBitcoinBased
                    ? t('home.clickToVerify', {
                        currency: activeNetwork.currency.toUpperCase(),
                      })
                    : ''
                }
              >
                <p
                  className={`text-xs ${
                    (isLedger || isTrezor) && isBitcoinBased
                      ? 'cursor-pointer'
                      : ''
                  }`}
                  onClick={handleHardwareAddressClick}
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
