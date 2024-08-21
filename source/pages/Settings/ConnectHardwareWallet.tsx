// @ts-nocheck
import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';
import { validateEthRpc, validateSysRpc } from '@pollum-io/sysweb3-network';

import { Layout, Tooltip, DefaultModal, Button } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { HardWallets } from 'scripts/Background/controllers/message-handler/types';
import { RootState } from 'state/store';

const ConnectHardwareWalletView: FC = () => {
  const [isTestnet, setIsTestnet] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedHardwareWallet, setSelectedHardwareWallet] = useState();
  const [isReconnect, setIsReconnect] = useState<boolean>(false);
  const { activeNetwork, isBitcoinBased, accounts, advancedSettings } =
    useSelector((state: RootState) => state.vault);
  const { t } = useTranslation();
  const { alert } = useUtils();
  const { controllerEmitter, web3Provider } = useController();
  const trezorAccounts = Object.values(accounts.Trezor);
  const ledgerAccounts = Object.values(accounts.Ledger);

  const { slip44 } = activeNetwork;

  const isSysUTXOMainnet = isBitcoinBased && activeNetwork.chainId === 57;

  const modalTitle = isReconnect
    ? t('settings.ledgerConnected')
    : t('settings.walletSelected');

  const modalDescription = isReconnect
    ? t('settings.ledgerConnectedMessage')
    : t('settings.walletSelectedMessage');

  const trezorSelectedButtonStyle = `${
    selectedHardwareWallet === 'trezor'
      ? 'bg-brand-blue400 border-2 border-brand-blue400 cursor-pointer'
      : 'bg-transparent border-2 border-white '
  }`;

  const ledgerSelectedButtonStyle = `${
    selectedHardwareWallet === 'ledger'
      ? 'bg-brand-blue400 border-2 border-brand-blue400 cursor-pointer'
      : 'bg-transparent border-2 border-white '
  }`;

  const confirmButtonDisbledStyle = `${
    isTestnet || selectedHardwareWallet === undefined
      ? 'opacity-60'
      : 'opacity-100'
  }`;

  const { isInCooldown }: CustomJsonRpcProvider = web3Provider;
  const isLedger = selectedHardwareWallet === 'ledger';

  const handleCreateHardwareWallet = async () => {
    setIsLoading(true);
    try {
      switch (selectedHardwareWallet) {
        case 'trezor':
          await controllerEmitter(
            ['wallet', 'importTrezorAccount'],
            [
              isBitcoinBased ? activeNetwork.currency : 'eth',
              `${activeNetwork.currency === 'sys' ? '57' : slip44}`,
              `${trezorAccounts.length}`,
            ]
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
            await controllerEmitter([
              'wallet',
              'ledgerSigner',
              'connectToLedgerDevice',
            ]);

            setIsModalOpen(true);
            setIsLoading(false);
            return;
          }

          if (webHidIsConnected) {
            await controllerEmitter(
              ['wallet', 'importLedgerAccount'],
              [
                isBitcoinBased ? activeNetwork.currency : 'eth',
                `${activeNetwork.currency === 'sys' ? '57' : slip44}`,
                `${ledgerAccounts.length}`,
                false,
              ]
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
        await controllerEmitter(
          ['wallet', 'importLedgerAccount'],
          [
            isBitcoinBased ? activeNetwork.currency : 'eth',
            `${activeNetwork.currency === 'sys' ? '57' : slip44}`,
            `${ledgerAccounts.length}`,
            true,
          ]
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

  const ledgerTooltipContent = useMemo(
    () =>
      isSysUTXOMainnet || !isBitcoinBased
        ? ''
        : t('settings.ledgerOnlyAvailable'),
    [isSysUTXOMainnet, isBitcoinBased]
  );

  const supportTooltipContent = useMemo(
    () =>
      isTestnet &&
      (isLedger
        ? t('settings.ledgerDoesntSupport')
        : t('settings.trezorDoesntSupport')),
    [isTestnet, isLedger]
  );

  const handleHardwalletBuyNow = useCallback(() => {
    window.open(isLedger ? 'https://www.ledger.com/' : 'https://trezor.io/');
  }, [isLedger]);

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
      <div className="flex flex-col  items-center justify-center w-full md:max-w-md">
        <div className="w-16 h-16  relative p-4 mb-6 rounded-[100px] bg-gradient-to-r from-[#284F94] from-[25.72%] to-[#FE0077] to-[141.55%]">
          <img
            className="absolute left-[30%]"
            src="/assets/icons/hardwallet.svg"
          />
        </div>
        <div className="scrollbar-styled px-2 h-80 text-sm overflow-y-auto md:h-3/4">
          {selectedHardwareWallet ? (
            <>
              <div className="flex flex-col text-center justify-center items-center w-max text-sm">
                <p>
                  {t('settings.connectYourWalletAndClick', {
                    hardwalletName:
                      selectedHardwareWallet === HardWallets.LEDGER
                        ? 'LEDGER'
                        : 'TREZOR',
                  })}
                </p>
                <p className="text-brand-gray200">
                  {t('settings.youCanUseAny', {
                    hardwalletName:
                      selectedHardwareWallet === HardWallets.LEDGER
                        ? 'Ledger'
                        : 'Trezor',
                  })}
                </p>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center">
              <p className="text-white text-center text-sm">
                {t('settings.selectTheHardware')}{' '}
              </p>

              <button
                className={`${trezorSelectedButtonStyle} mt-6 rounded-full py-2 w-80 mx-auto text-center text-base font-medium mb-[6px] hover:bg-brand-blue400 hover:border-brand-blue400 hover:cursor-pointer`}
                onClick={() => setSelectedHardwareWallet('trezor')}
                id="trezor-btn"
              >
                Trezor
              </button>
              {advancedSettings?.ledger && (
                <Tooltip content={ledgerTooltipContent}>
                  <button
                    className={`${ledgerSelectedButtonStyle} rounded-full py-2 w-80 mx-auto text-center text-base font-medium hover:bg-brand-blue400 hover:border-brand-blue400 hover:cursor-pointer`}
                    onClick={() => {
                      if (isSysUTXOMainnet || !isBitcoinBased) {
                        setSelectedHardwareWallet('ledger');
                      }
                      return;
                    }}
                    id="trezor-btn"
                  >
                    Ledger
                  </button>
                </Tooltip>
              )}
            </div>
          )}
        </div>
        <div className="absolute bottom-7">
          {selectedHardwareWallet && (
            <div className="w-[22rem] gap-3 flex flex-col mb-10 mx-auto p-4  text-brand-white text-xs bg-alpha-whiteAlpha100 border border-dashed border-alpha-whiteAlpha300 rounded-[20px] ">
              <p className="font-medium">{t('settings.dontHaveWallet')}</p>
              <div className="flex">
                <p>
                  {isLedger
                    ? t('settings.orderLedger')
                    : t('settings.orderTrezor')}
                  <span
                    className="hover:text-button-primary cursor-pointer pl-1 underline"
                    onClick={handleHardwalletBuyNow}
                  >
                    {t('settings.buyNow')}
                  </span>
                </p>
              </div>
            </div>
          )}
          <Button
            type="button"
            onClick={handleCreateHardwareWallet}
            disabled={isTestnet || selectedHardwareWallet === undefined}
            loading={isLoading}
            id="connect-btn"
            className={`${confirmButtonDisbledStyle} cursor-pointer bg-white w-[22rem] mt-3 h-10 text-brand-blue200 text-base font-base font-medium rounded-2xl`}
          >
            <Tooltip content={supportTooltipContent}>
              <ButtonLabel />
            </Tooltip>
          </Button>
        </div>
      </div>
    </Layout>
  );
};

export default ConnectHardwareWalletView;
