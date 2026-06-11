import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Button } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { KeyringAccountType } from 'types/network';

const ADDRESS_WAIT_TIMEOUT_MS = 8000;

export const Receive = () => {
  const { useCopyClipboard, alert, navigate } = useUtils();
  const [isCopied, copyText] = useCopyClipboard();
  const { t } = useTranslation();
  const [hasTimedOut, setHasTimedOut] = useState(false);

  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];

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

    alert.success(t('home.addressCopied'));
  }, [isCopied, alert, t]);

  // The address comes from the store; if it never materializes, surface a
  // retry path instead of spinning forever
  useEffect(() => {
    if (activeAccount?.address) {
      setHasTimedOut(false);
      return;
    }

    const timer = setTimeout(
      () => setHasTimedOut(true),
      ADDRESS_WAIT_TIMEOUT_MS
    );
    return () => clearTimeout(timer);
  }, [activeAccount?.address]);

  return (
    <>
      {activeAccount.address ? (
        <div className="flex flex-col items-center justify-center w-full">
          {/* Network + account-type context so users verify they're on the
              right chain before sharing the address */}
          <div className="flex items-center gap-2 mb-4 px-3 py-1 rounded-full bg-alpha-whiteAlpha100 border border-alpha-whiteAlpha300">
            <span className="text-xs text-white font-medium">
              {activeNetwork?.label}
            </span>
            <span className="text-xs text-brand-gray200">•</span>
            <span className="text-xs text-brand-gray200">
              {accountTypeLabel}
            </span>
          </div>

          <div id="qr-code">
            <QRCodeSVG
              value={activeAccount.address}
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
              {activeAccount.address}
            </p>
          </div>

          <div className="relative w-[96%] mt-6" id="copy-address-receive-btn">
            <Button
              variant="neutral"
              className="text-sm text-brand-royalblue"
              type="button"
              fullWidth={true}
              onClick={() => copyText(activeAccount.address)}
            >
              <span className="text-xs">{t('buttons.copy')}</span>
            </Button>
          </div>
        </div>
      ) : hasTimedOut ? (
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
