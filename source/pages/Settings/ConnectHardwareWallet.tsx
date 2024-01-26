// @ts-nocheck
import { Disclosure } from '@headlessui/react';
import React, { FC, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';
import { validateEthRpc, validateSysRpc } from '@pollum-io/sysweb3-network';

import {
  Layout,
  Icon,
  Tooltip,
  NeutralButton,
  DefaultModal,
  Card,
} from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

const ConnectHardwareWalletView: FC = () => {
  const [isTestnet, setIsTestnet] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedHardwareWallet, setSelectedHardwareWallet] =
    useState('trezor');
  const [isReconnect, setIsReconnect] = useState<boolean>(false);
  const { activeNetwork, isBitcoinBased, accounts, advancedSettings } =
    useSelector((state: RootState) => state.vault);
  const { t } = useTranslation();
  const { alert } = useUtils();
  const trezorAccounts = Object.values(accounts.Trezor);
  const ledgerAccounts = Object.values(accounts.Ledger);

  const { slip44 } = activeNetwork;

  const isSysUTXOMainnet = isBitcoinBased && activeNetwork.chainId === 57;
  const ledgerButtonColor =
    selectedHardwareWallet === 'ledger'
      ? 'bg-bkg-3 border-brand-deepPink cursor-pointer'
      : 'bg-bkg-1 border-brand-royalblue cursor-pointer';

  const trezorButtonColor =
    selectedHardwareWallet === 'trezor'
      ? 'bg-bkg-3 border-brand-deepPink'
      : 'bg-bkg-1 border-brand-royalblue';

  const modalTitle = isReconnect
    ? t('settings.ledgerConnected')
    : t('settings.walletSelected');

  const modalDescription = isReconnect
    ? t('settings.ledgerConnectedMessage')
    : t('settings.walletSelectedMessage');

  const controller = getController();

  const { isInCooldown }: CustomJsonRpcProvider =
    controller.wallet.ethereumTransaction.web3Provider;
  const isLedger = selectedHardwareWallet === 'ledger';

  const handleCreateHardwareWallet = async () => {
    setIsLoading(true);
    try {
      switch (selectedHardwareWallet) {
        case 'trezor':
          await controller.wallet.importTrezorAccount(
            isBitcoinBased ? activeNetwork.currency : 'eth',
            `${activeNetwork.currency === 'sys' ? '57' : slip44}`,
            `${trezorAccounts.length}`
          );
          setIsModalOpen(true);
          setIsLoading(false);
          break;
        case 'ledger':
          // it only works in fullscreen mode.
          const LEDGER_USB_VENDOR_ID = '0x2c97';

          const connectedDevices = await window.navigator.hid.requestDevice({
            filters: [{ vendorId: LEDGER_USB_VENDOR_ID }],
          });
          const webHidIsConnected = connectedDevices.some(
            (device: any) => device.vendorId === Number(LEDGER_USB_VENDOR_ID)
          );

          if (isReconnect) {
            await controller.wallet.ledgerSigner.connectToLedgerDevice();
            setIsModalOpen(true);
            setIsLoading(false);
            return;
          }

          if (webHidIsConnected) {
            await controller.wallet.importLedgerAccount(
              isBitcoinBased ? activeNetwork.currency : 'eth',
              `${activeNetwork.currency === 'sys' ? '57' : slip44}`,
              `${ledgerAccounts.length}`,
              false
            );
            setIsModalOpen(true);
            setIsLoading(false);
          }
          break;
      }
    } catch (error) {
      setIsLoading(false);
      const isAlreadyConnected = error.message.includes('already open.');
      const isDeviceLocked = error.message.includes('Locked device');

      if (isAlreadyConnected) {
        await controller.wallet.importLedgerAccount(
          isBitcoinBased ? activeNetwork.currency : 'eth',
          `${activeNetwork.currency === 'sys' ? '57' : slip44}`,
          `${ledgerAccounts.length}`,
          true
        );
        setIsModalOpen(true);
        return;
      }
      if (isDeviceLocked) {
        alert.removeAll();
        alert.error(t('settings.lockedDevice'));
        return;
      }
      alert.removeAll();
      alert.error(t('settings.errorCreatingHardWallet'));
    }
  };

  const verifyIfIsTestnet = async () => {
    const { url } = activeNetwork;

    const { chain }: any = isBitcoinBased
      ? await validateSysRpc(url)
      : await validateEthRpc(url, isInCooldown);

    return Boolean(chain === 'test' || chain === 'testnet');
  };

  const ButtonLabel = () => {
    switch (isReconnect) {
      case true:
        if (isLedger) {
          return <p>{t('buttons.reconnect')}</p>;
        }
        return <p>{t('buttons.connect')}</p>;

      case false:
        if (
          (isLedger && !ledgerAccounts.length) ||
          (!isLedger && !trezorAccounts.length)
        ) {
          return <p>{t('buttons.connect')}</p>;
        }
        return <p>{t('buttons.addAccount')}</p>;
    }
  };

  useEffect(() => {
    verifyIfIsTestnet().then((isTestnetResponse) =>
      setIsTestnet(isTestnetResponse)
    );
  }, [activeNetwork, activeNetwork.chainId]);

  useEffect(() => {
    const urlSearch = window.location.search;
    if (urlSearch) {
      setIsReconnect(true);
    }
  }, []);

  return (
    <Layout title={t('settings.hardwareWallet')} id="hardware-wallet-title">
      <DefaultModal
        show={isModalOpen}
        title={modalTitle}
        description={modalDescription}
        onClose={() => {
          window.close();
        }}
      />
      <div className="flex flex-col items-center justify-center w-full md:max-w-md">
        <div className="scrollbar-styled px-2 h-80 text-sm overflow-y-auto md:h-3/4">
          <p className="text-white text-sm">
            {t('settings.selectTheHardware')}{' '}
            {!trezorAccounts.length
              ? t('settings.toConnect')
              : t('settings.toAddAccount')}{' '}
            {t('settings.toPali')}
          </p>

          <p
            className={`${trezorButtonColor} rounded-full py-2 w-80 md:w-full mx-auto text-center border text-sm my-6 cursor-pointer`}
            onClick={() => setSelectedHardwareWallet('trezor')}
            id="trezor-btn"
          >
            Trezor
          </p>
          {advancedSettings?.ledger && (
            <Tooltip
              content={
                isSysUTXOMainnet || !isBitcoinBased
                  ? ''
                  : t('settings.ledgerOnlyAvailable')
              }
            >
              <p
                className={`${ledgerButtonColor} rounded-full py-2 w-80 md:w-full mx-auto text-center border text-sm my-6`}
                onClick={() => {
                  if (isSysUTXOMainnet || !isBitcoinBased) {
                    setSelectedHardwareWallet('ledger');
                  }
                  return;
                }}
                id="trezor-btn"
              >
                Ledger
              </p>
            </Tooltip>
          )}

          {isLedger && (
            <div className="flex flex-col items-center justify-center w-full md:max-w-full mb-6">
              <Card type="info" className="border-alert-darkwarning">
                <div>
                  <div className="text-xs text-alert-darkwarning font-bold">
                    <p>
                      {isSysUTXOMainnet
                        ? t('settings.dontForget')
                        : t('settings.dontForgetEvm')}
                    </p>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {isLedger && (
            <div className="mb-6 mx-auto p-4 w-80 text-brand-white text-xs bg-bkg-4 border border-dashed border-brand-royalblue rounded-lg md:w-full">
              <p>
                {isSysUTXOMainnet
                  ? t('settings.toUseLedger')
                  : t('settings.toUseLedgerEvm')}
              </p>

              {isSysUTXOMainnet && (
                <p
                  className="mt-2 w-32 hover:text-brand-white text-button-primary cursor-pointer"
                  onClick={() =>
                    window.open(
                      'https://github.com/osiastedian/ledger-app-syscoin'
                    )
                  }
                >
                  {t('settings.githubLink')}
                </p>
              )}
            </div>
          )}

          <div className="mb-6 mx-auto p-4 w-80 text-brand-white text-xs bg-bkg-4 border border-dashed border-brand-royalblue rounded-lg md:w-full">
            <p>
              <b>{t('settings.dontHaveWallet')}</b>
              <br />
              <br />
              {isLedger ? t('settings.orderLedger') : t('settings.orderTrezor')}
            </p>

            <p
              className="mt-2 w-32 hover:text-brand-white text-button-primary cursor-pointer"
              onClick={() =>
                window.open(
                  isLedger ? 'https://www.ledger.com/' : 'https://trezor.io/'
                )
              }
            >
              {t('settings.buyNow')}
            </p>
          </div>

          <Disclosure>
            {({ open }) => (
              <>
                <Disclosure.Button
                  className={`${
                    open ? 'rounded-t-lg' : 'rounded-lg'
                  } mt-3 w-80 md:w-full py-2 px-4 flex justify-between items-center mx-auto border border-bkg-1 cursor-pointer transition-all duration-300 bg-bkg-1 learn-more-btn`}
                >
                  {t('connections.learnMore')}
                  <Icon
                    name="select-down"
                    className={`${
                      open ? 'transform rotate-180' : ''
                    } mb-1 text-brand-deepPink100`}
                  />
                </Disclosure.Button>

                <Disclosure.Panel>
                  <div className="flex flex-col items-start justify-start mx-auto px-4 py-2 w-80 bg-bkg-3 border border-bkg-3 rounded-b-lg cursor-pointer transition-all duration-300 md:w-full md:max-w-md">
                    <p className="my-2 text-sm">
                      1 - {t('settings.connectToAHardwareWallet')}
                    </p>

                    <span className="mb-4 text-xs">
                      {t('settings.connectYourHardwareWallet')}
                    </span>

                    <p className="my-2 text-sm">
                      2 - {t('settings.startUsingSys')}
                    </p>

                    <span className="mb-1 text-xs">
                      {t('settings.useYourHardwareAccount')}
                    </span>
                  </div>
                </Disclosure.Panel>
              </>
            )}
          </Disclosure>
        </div>

        <div className="absolute bottom-12 md:static md:mt-6 mb-10">
          <NeutralButton
            type="button"
            onClick={handleCreateHardwareWallet}
            disabled={isTestnet}
            loading={isLoading}
            id="connect-btn"
          >
            <Tooltip
              content={
                isTestnet &&
                (isLedger
                  ? t('settings.ledgerDoesntSupport')
                  : t('settings.trezorDoesntSupport'))
              }
            >
              <ButtonLabel />
            </Tooltip>
          </NeutralButton>
        </div>
      </div>
    </Layout>
  );
};

export default ConnectHardwareWalletView;
