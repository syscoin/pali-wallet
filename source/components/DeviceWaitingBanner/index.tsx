import React from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

/**
 * Shared interstitial banner shown while waiting for an out-of-app
 * confirmation: hardware wallets (Trezor/Ledger) or WebAuthn passkeys
 * (smart accounts). Renders nothing for plain key accounts.
 *
 * Rendered through a portal as a fixed overlay pinned to the bottom of
 * the viewport, so it stays visible regardless of where the host screen
 * placed it in the layout or how far the page is scrolled.
 */
export const DeviceWaitingBanner: React.FC<{
  account: any;
  show: boolean;
}> = ({ account, show }) => {
  const { t } = useTranslation();

  if (!show || !account) return null;

  const isHardware = account.isTrezorWallet || account.isLedgerWallet;
  const authScheme =
    account.smartAccount?.auth?.scheme || account.smartAccount?.auth?.module;
  const usesPasskey =
    account.isSmartAccount &&
    (authScheme === 'p256-webauthn' || authScheme === 'composite');

  if (!isHardware && !usesPasskey) return null;

  const deviceName = account.isTrezorWallet ? 'Trezor' : 'Ledger';
  const title = isHardware
    ? t('transactions.confirmOnDevice')
    : t('transactions.useYourPasskey');
  const subtitle = isHardware
    ? t('transactions.checkYourDevice', { device: deviceName })
    : t('transactions.passkeyPrompt');

  // z-[90]: above headers/toasts (z-[60]) but below warning/error modals
  // (z-[100]+) -- see the z-index ladder documented in Dialog.tsx.
  return createPortal(
    <div className="fixed inset-x-0 bottom-4 z-[90] flex justify-center px-4 pointer-events-none">
      <div
        className="flex items-center gap-3 w-full max-w-[22rem] px-4 py-3 rounded-[10px] bg-brand-blue600 border border-alpha-whiteAlpha300 shadow-lg animate-fadeIn"
        data-testid="device-waiting-banner"
      >
        <span className="relative flex h-3 w-3 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-royalblue opacity-75" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-brand-royalblue" />
        </span>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-white">{title}</span>
          <span className="text-xs text-brand-gray200">{subtitle}</span>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default DeviceWaitingBanner;
