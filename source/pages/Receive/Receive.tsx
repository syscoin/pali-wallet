import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Button } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { INetworkType, KeyringAccountType } from 'types/network';
import { getWalletNavigationScope } from 'utils/navigationState';
import { isValidEthereumAddress, isValidSYSAddress } from 'utils/validations';

const ADDRESS_WAIT_TIMEOUT_MS = 8000;

export const Receive = () => {
  const { useCopyClipboard, alert, navigate } = useUtils();
  const { t } = useTranslation();
  const [timedOutScope, setTimedOutScope] = useState<string>();
  const [validatedAddress, setValidatedAddress] = useState<{
    address: string;
    scope: string;
    valid: boolean;
  }>();

  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const networkCatalog = useSelector(
    (state: RootState) => state.vaultGlobal.networks[activeNetwork.kind]
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];
  const walletScope = useSelector(() =>
    JSON.stringify(getWalletNavigationScope())
  );
  const address =
    typeof activeAccount?.address === 'string' ? activeAccount.address : '';
  const isEthereum = activeNetwork.kind === INetworkType.Ethereum;
  const isAddressReady = isEthereum
    ? Boolean(address)
    : validatedAddress?.address === address &&
      validatedAddress?.scope === walletScope;
  const canReceive = isEthereum
    ? isValidEthereumAddress(address)
    : isAddressReady && validatedAddress?.valid;
  const [isCopied, copyText, isCurrentCopy] = useCopyClipboard(
    1000,
    walletScope
  );

  const showChainNumber = useMemo(
    () =>
      Object.values(networkCatalog).some(
        (network) =>
          network.label === activeNetwork.label &&
          network.chainId !== activeNetwork.chainId
      ),
    [networkCatalog, activeNetwork.label, activeNetwork.chainId]
  );

  const accountTypeLabel = useMemo(() => {
    switch (activeAccountMeta.type) {
      case KeyringAccountType.Trezor:
        return 'Trezor';
      case KeyringAccountType.Ledger:
        return 'Ledger';
      case KeyringAccountType.SmartAccount:
        return t('receive.smartAccount');
      case KeyringAccountType.Imported:
        return t('components.imported');
      default:
        return t('receive.hdAccount');
    }
  }, [activeAccountMeta.type, t]);

  useEffect(() => {
    if (!isCopied) return;

    alert.success(t('home.addressCopied'), undefined, isCurrentCopy);
  }, [isCopied, isCurrentCopy, alert, t]);

  useEffect(() => {
    let current = true;
    setValidatedAddress(undefined);
    if (!address || isEthereum) return;
    const complete = (valid: boolean) => {
      if (current) setValidatedAddress({ address, scope: walletScope, valid });
    };
    if (activeNetwork.kind === INetworkType.Syscoin)
      void isValidSYSAddress(address, activeNetwork.chainId).then(complete);
    else complete(false);
    return () => {
      current = false;
    };
  }, [
    address,
    walletScope,
    activeNetwork.kind,
    activeNetwork.chainId,
    isEthereum,
  ]);

  // Neither missing addresses nor unfinished validation may spin forever.
  useEffect(() => {
    setTimedOutScope(undefined);
    if (isAddressReady) return;
    const timer = setTimeout(
      () => setTimedOutScope(walletScope),
      ADDRESS_WAIT_TIMEOUT_MS
    );
    return () => clearTimeout(timer);
  }, [isAddressReady, walletScope]);

  return (
    <>
      {canReceive ? (
        <div className="flex flex-col items-center justify-center w-full">
          {/* Network + account-type context so users verify they're on the
              right chain before sharing the address */}
          <div className="flex max-w-full items-center gap-2 mb-4 px-3 py-1 rounded-full bg-alpha-whiteAlpha100 border border-alpha-whiteAlpha300">
            <span className="min-w-0 break-words text-xs text-white font-medium">
              {showChainNumber ? (
                <>
                  <span className="block">{activeNetwork.label}</span>
                  <span className="block text-xs font-normal text-brand-gray200">
                    {t('settings.chainNumber', {
                      chainId: activeNetwork.chainId,
                    })}
                  </span>
                </>
              ) : (
                activeNetwork?.label
              )}
            </span>
            <span className="shrink-0 text-xs text-brand-gray200">•</span>
            <span className="shrink-0 text-xs text-brand-gray200">
              {accountTypeLabel}
            </span>
          </div>

          <div id="qr-code">
            <QRCodeSVG
              value={address}
              bgColor="#fff"
              fgColor="#000"
              style={{
                height: '186px',
                width: '186px',
                padding: '6px',
                backgroundColor: '#fff',
                borderRadius: '10px',
              }}
            />
          </div>
          <div className="flex flex-wrap w-[60%]">
            <p
              className="mt-4 text-sm text-center"
              style={{ wordBreak: 'break-all' }}
            >
              {address}
            </p>
          </div>

          <div className="relative w-[96%] mt-6" id="copy-address-receive-btn">
            <Button
              variant="neutral"
              className="text-sm text-brand-royalblue"
              type="button"
              fullWidth={true}
              onClick={() => copyText(address)}
            >
              <span className="text-xs">{t('buttons.copy')}</span>
            </Button>
          </div>
        </div>
      ) : isAddressReady || timedOutScope === walletScope ? (
        <div className="flex flex-col items-center justify-center h-80 gap-4 px-6">
          <p className="text-sm text-brand-gray200 text-center">
            {t('receive.addressUnavailable')}
          </p>
          <Button
            variant="neutral"
            className="text-sm text-brand-royalblue"
            type="button"
            onClick={() => navigate('/home')}
          >
            <span className="text-xs">{t('receive.retry')}</span>
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-center h-80">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-brand-blue500"></div>
        </div>
      )}
    </>
  );
};
