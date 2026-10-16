import { toSvg } from 'jdenticon';
import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { IconButton, Icon, Tooltip, ConfirmationModal } from 'components/index';
import SkeletonLoader from 'components/Loader/SkeletonLoader';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectActiveAccount } from 'state/vault/selectors';
import { IKeyringAccountState, KeyringAccountType } from 'types/network';
import { ellipsis, adjustUrl } from 'utils/index';
import { isUserCancellationError } from 'utils/isUserCancellationError';
import {
  createBrowsingNavigationContext,
  navigateWithContext,
} from 'utils/navigationState';

// A dialog/route may disappear while the device RPC is still pending. Keep
// this latch at renderer-module scope so a new AccountHeader cannot start a
// second device prompt; UI cancellation only invalidates the result below.
let hardwareVerificationRequest: object | undefined;
const hardwareVerificationListeners = new Set<() => void>();
const subscribeHardwareVerification = (listener: () => void) => {
  hardwareVerificationListeners.add(listener);
  return () => hardwareVerificationListeners.delete(listener);
};
const isHardwareVerificationPending = () =>
  Boolean(hardwareVerificationRequest);
const notifyHardwareVerification = () => {
  hardwareVerificationListeners.forEach((listener) => listener());
};

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
  const isSwitchingAccount = useSelector(
    (state: RootState) => state.vaultGlobal.isSwitchingAccount
  );
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );
  const location = useLocation();
  const { useCopyClipboard, alert, navigate } = useUtils();
  const { t } = useTranslation();
  const { controllerEmitter } = useController();
  const [copied, copy] = useCopyClipboard();
  const isLoading = useSyncExternalStore(
    subscribeHardwareVerification,
    isHardwareVerificationPending
  );
  const [isOpenModal, setIsOpenModal] = useState(false);
  const verificationScope = JSON.stringify([
    activeAccount?.id,
    activeAccount?.type,
    currentAccount?.address,
    currentAccount?.xpub,
    isBitcoinBased,
    activeNetwork.kind,
    activeNetwork.chainId,
    activeNetwork.url,
    activeNetwork.currency,
    activeNetwork.slip44,
    networkStatus,
    isSwitchingAccount,
    location.pathname,
    location.search,
    location.hash,
    location.key,
  ]);
  const verification = useRef({
    generation: 0,
    scope: verificationScope,
    mounted: true,
  });
  // Invalidate synchronously on render, before an old device response can
  // settle between a selection change and its passive effect.
  if (verification.current.scope !== verificationScope) {
    verification.current.scope = verificationScope;
    verification.current.generation += 1;
  }
  const closeVerification = useCallback(() => {
    verification.current.generation += 1;
    setIsOpenModal(false);
  }, []);
  useEffect(() => {
    closeVerification();
  }, [verificationScope, closeVerification]);
  useEffect(() => {
    verification.current.mounted = true;
    // A native hash change can precede React Router's next render. Closing
    // only discards this UI request; it does not cancel device activity.
    window.addEventListener('hashchange', closeVerification);
    window.addEventListener('popstate', closeVerification);
    window.addEventListener('pagehide', closeVerification);
    return () => {
      verification.current.mounted = false;
      verification.current.generation += 1;
      window.removeEventListener('hashchange', closeVerification);
      window.removeEventListener('popstate', closeVerification);
      window.removeEventListener('pagehide', closeVerification);
    };
  }, [closeVerification]);

  const isLedger = useMemo(
    () => activeAccount?.type === KeyringAccountType.Ledger,
    [activeAccount?.type]
  );

  const isTrezor = useMemo(
    () => activeAccount?.type === KeyringAccountType.Trezor,
    [activeAccount?.type]
  );

  // Show identity skeletons during both network and account switches so the
  // header never displays stale account data mid-switch
  const isSwitchInProgress = useMemo(
    () => networkStatus === 'switching' || isSwitchingAccount,
    [networkStatus, isSwitchingAccount]
  );

  const editAccount = useCallback(
    (account: IKeyringAccountState) => {
      if (!account || !activeAccount?.type) {
        return;
      }

      const returnContext = createBrowsingNavigationContext(location);
      navigateWithContext(
        navigate,
        '/settings/edit-account',
        { id: account.id, accountType: activeAccount.type },
        returnContext
      );
    },
    [activeAccount?.type, navigate, location]
  );

  const openAccountInExplorer = useCallback(() => {
    const accountAddress = currentAccount?.address;
    const xpub = (currentAccount as any)?.xpub as string | undefined;
    const isImported = Boolean((currentAccount as any)?.isImported);
    if (!accountAddress) return;

    // Prefer XPUB page for UTXO accounts when available, including imported extended-key accounts.
    // Fall back to /address for:
    // - EVM chains
    // - UTXO single-address imports (WIF) where xpub === address
    // - missing xpub
    const isSingleAddressUtxoImport =
      isImported && Boolean(xpub) && xpub === accountAddress;
    const useAddressPathForUtxo =
      isBitcoinBased && (!xpub || isSingleAddressUtxoImport);
    const pathSegment = isBitcoinBased
      ? useAddressPathForUtxo
        ? 'address'
        : 'xpub'
      : 'address';
    const identifier = isBitcoinBased
      ? useAddressPathForUtxo
        ? accountAddress
        : xpub!
      : accountAddress;

    const base = adjustUrl(activeNetwork.explorer || activeNetwork.url);
    const url = `${base}${pathSegment}/${encodeURIComponent(identifier)}`;
    window.open(url, '_blank');
  }, [
    currentAccount?.address,
    (currentAccount as any)?.xpub,
    (currentAccount as any)?.isImported,
    isBitcoinBased,
    activeNetwork.explorer,
    activeNetwork.url,
  ]);

  const handleVerifyAddress = useCallback(async () => {
    if (!isOpenModal || hardwareVerificationRequest) return;
    const request = {};
    hardwareVerificationRequest = request;
    notifyHardwareVerification();
    const generation = ++verification.current.generation;
    const nativeUrl = window.location.href;
    const isCurrent = () =>
      verification.current.mounted &&
      verification.current.generation === generation &&
      verification.current.scope === verificationScope &&
      window.location.href === nativeUrl;
    try {
      // Route through ethereumTransaction.verifyUtxoAddress, which dispatches to the correct HW
      await (controllerEmitter as any)(
        ['wallet', 'ethereumTransaction', 'verifyUtxoAddress'],
        [activeAccount?.id, activeNetwork.currency, activeNetwork.slip44],
        300000 // 5 minutes timeout for hardware wallet operations
      );

      if (!isCurrent()) return;
      setIsOpenModal(false);
      alert.success(t('home.addressVerified'));
    } catch (error: any) {
      if (!isCurrent()) return;
      // Handle user cancellation - show specific message
      if (isUserCancellationError(error)) {
        alert.error(t('home.verificationDeniedByUser'));
      } else {
        // For any other errors, show a generic error message
        alert.error(t('send.verificationFailed'));
      }

      setIsOpenModal(false);
    } finally {
      // Only settlement of this exact RPC releases the device, even if its
      // dialog was closed, the account changed, or the component unmounted.
      if (hardwareVerificationRequest === request) {
        hardwareVerificationRequest = undefined;
        notifyHardwareVerification();
      }
    }
  }, [
    activeAccount?.id,
    activeNetwork.currency,
    activeNetwork.slip44,
    alert,
    t,
    isOpenModal,
    verificationScope,
  ]);

  const handleHardwareAddressClick = useCallback(() => {
    if ((isLedger || isTrezor) && isBitcoinBased) {
      verification.current.generation += 1;
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
        onClose={closeVerification}
        show={isOpenModal}
        isButtonLoading={isLoading}
        allowCloseWhileLoading
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
          {isSwitchInProgress ? (
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
              {currentAccount?.isSmartAccount && (
                <Tooltip content={t('smartAccountHub.openHub')}>
                  <button
                    type="button"
                    id="smart-account-hub-badge"
                    onClick={() => navigate('/home/smart-account')}
                    className="ml-1 inline-flex items-center align-middle px-1.5 py-0.5 rounded-pill bg-brand-royalblue bg-opacity-40 text-[9px] font-semibold uppercase tracking-wide text-brand-blue100 hover:bg-opacity-70 transition-colors duration-200"
                  >
                    {t('smartAccountHub.badge')}
                  </button>
                </Tooltip>
              )}
            </p>
          )}
          {isSwitchInProgress ? (
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
