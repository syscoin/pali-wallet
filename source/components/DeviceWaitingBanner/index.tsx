import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Shared interstitial banner shown while waiting for an out-of-app
 * confirmation: hardware wallets (Trezor/Ledger) or WebAuthn passkeys
 * (smart accounts). Renders nothing for plain key accounts.
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

  return (
    <div
      className="flex items-center gap-3 w-full px-4 py-3 mb-3 rounded-[10px] bg-alpha-whiteAlpha100 border border-alpha-whiteAlpha300 animate-fadeIn"
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
  );
};

export default DeviceWaitingBanner;
