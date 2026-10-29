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

import { AccountExplorerAvatar } from 'components/AccountExplorerAvatar';
import { IconButton, Icon, Tooltip, ConfirmationModal } from 'components/index';
import SkeletonLoader from 'components/Loader/SkeletonLoader';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { selectActiveAccount } from 'state/vault/selectors';
import { IKeyringAccountState, KeyringAccountType } from 'types/network';
import { ellipsis } from 'utils/index';
import { isUserCancellationError } from 'utils/isUserCancellationError';
import {
  createBrowsingNavigationContext,
  navigateWithContext,
} from 'utils/navigationState';
import {
  buildExplorerUrl,
  hasExplorer,
  selectExplorerNetwork,
} from 'utils/strings';

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
  const explorerNetwork = useSelector(selectExplorerNetwork);
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
  const isLoading = useSyncExternalStore(
    subscribeHardwareVerification,
    isHardwareVerificationPending
  );
  const [isOpenModal, setIsOpenModal] = useState(false);
  const identityScope = [
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
    location.pathname,
    location.search,
    location.hash,
    location.key,
  ];
  const verificationScope = JSON.stringify([
    ...identityScope,
    networkStatus,
    isSwitchingAccount,
  ]);
  const [copied, copy, isCurrentCopy] = useCopyClipboard(
    1000,
    JSON.stringify(identityScope)
  );
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
    if (!accountAddress || !hasExplorer(explorerNetwork)) return;

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

    window.open(
      buildExplorerUrl(
        explorerNetwork.explorer || explorerNetwork.url,
        pathSegment,
        identifier
      ),
      '_blank'
    );
  }, [
    currentAccount?.address,
    (currentAccount as any)?.xpub,
    (currentAccount as any)?.isImported,
    isBitcoinBased,
    explorerNetwork,
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

    alert.info(t('home.addressCopied'), undefined, isCurrentCopy);
  }, [copied, alert, t, isCurrentCopy]);

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
      <div className="flex min-w-0 flex-1 ml-[15px] items-center text-brand-white">
        <AccountExplorerAvatar
          available={hasExplorer(explorerNetwork)}
          onClick={openAccountInExplorer}
          header
        />

        <div className="min-w-0 flex-1 items-center justify-center px-1 text-brand-white">
          {isSwitchInProgress ? (
            <SkeletonLoader width="150px" height="20px" />
          ) : (
            <p
              className="mb-1 flex min-w-0 items-center gap-1 text-base font-medium"
              id="active-account-label items-center"
            >
              <span className="min-w-0 truncate" title={currentAccount?.label}>
                {currentAccount?.label}
              </span>
              <IconButton
                aria-label={t('buttons.edit')}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue500"
                onClick={() => editAccount(currentAccount)}
                type="primary"
                shape="circle"
              >
                <Icon
                  name="edit"
                  className="hover:text-brand-royalblue text-xs flex justify-center w-4 h-4"
                />
              </IconButton>
              {currentAccount?.isSmartAccount && (
                <Tooltip
                  content={t('smartAccountHub.openHub')}
                  childrenClassName="shrink-0"
                >
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
            <div className="flex min-w-0 items-center">
              <Tooltip
                childrenClassName="min-w-0"
                content={
                  (isLedger || isTrezor) && isBitcoinBased
                    ? t('home.clickToVerify', {
                        currency: activeNetwork.currency.toUpperCase(),
                      })
                    : ''
                }
              >
                {(isLedger || isTrezor) && isBitcoinBased ? (
                  <button
                    type="button"
                    aria-label={t('home.clickToVerify', {
                      currency: activeNetwork.currency.toUpperCase(),
                    })}
                    className="min-w-0 truncate text-left text-xs cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue500"
                    onClick={handleHardwareAddressClick}
                  >
                    {ellipsis(currentAccount?.address, 6, 14)}
                  </button>
                ) : (
                  <p className="min-w-0 truncate text-xs">
                    {ellipsis(currentAccount?.address, 6, 14)}
                  </p>
                )}
              </Tooltip>
              <IconButton
                onClick={copyAddress}
                aria-label={t('buttons.copy')}
                type="primary"
                shape="circle"
                className="ml-2 shrink-0"
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
