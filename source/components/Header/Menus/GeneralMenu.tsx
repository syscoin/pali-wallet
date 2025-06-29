import { Menu } from '@headlessui/react';
import { Badge } from 'antd';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import slider from 'assets/all_assets/sliderIcon.png';
import {
  KeySvg,
  PaliWhiteSmallIconSvg,
  TrashIconSvg,
  LanguageIconSvg,
  DollarSignIconSvg,
  HelpIconSvg,
  LockIconSvg,
} from 'components/Icon/Icon';
import { Icon, Tooltip, AccountMenu } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { truncate, getHost, getTabUrl } from 'utils/index';

interface IGeneralMenuProps {
  disabled?: boolean;
}

export const GeneralMenu: React.FC<IGeneralMenuProps> = ({
  disabled = false,
}) => {
  const { controllerEmitter } = useController();
  const { t } = useTranslation();
  const { navigate } = useUtils();
  const {} = useSelector((state: RootState) => state.vault);
  const {
    changingConnectedAccount: { isChangingConnectedAccount },
    advancedSettings,
  } = useSelector((state: RootState) => state.vaultGlobal);
  const [currentTab, setCurrentTab] = useState({
    host: '',
    isConnected: false,
  });
  const className = currentTab.isConnected ? 'success' : 'error';

  const handleLogout = () => {
    controllerEmitter(['wallet', 'lock']);

    navigate('/');
  };

  useEffect(() => {
    const getTabData = async () => {
      const url = await getTabUrl();

      if (!url) return;

      const host = getHost(url);

      controllerEmitter(['dapp', 'isConnected'], [host]).then(
        (isConnected: boolean) => {
          setCurrentTab({ host, isConnected });
        }
      );
    };

    getTabData();
  }, []);

  useEffect(() => {
    if (!isChangingConnectedAccount) {
      getTabUrl().then(async (url: string) => {
        const host = getHost(url);

        controllerEmitter(['dapp', 'isConnected'], [host]).then(
          (isConnected: boolean) => {
            setCurrentTab({ host, isConnected });
          }
        );
      });
    }
  }, [isChangingConnectedAccount]);

  return (
    <Menu
      as="div"
      className="absolute z-[9999] right-4 top-2 flex items-center gap-2 justify-evenly"
    >
      {({ open }) => (
        <>
          <Tooltip content={truncate(currentTab.host)}>
            <div
              onClick={() => navigate('/settings/networks/connected-sites')}
              className="relative mx-1.5 text-brand-white cursor-pointer"
            >
              <Icon
                name="globe"
                className="hover:text-brand-royalblue text-white"
              />

              <Badge
                className={`absolute -right-1 top-1.2 w-3 h-3 text-warning-${className} bg-warning-${className} rounded-full`}
              />
            </div>
          </Tooltip>
          {advancedSettings['refresh'] && (
            <div
              onClick={() => controllerEmitter(['refresh'], [])}
              className="mx-1.5 hover:text-brand-royalblue text-brand-white cursor-pointer"
            >
              <Icon name="reload" />
            </div>
          )}
          <Menu.Button
            as="button"
            disabled={disabled}
            className={`mx-1.5 ${
              disabled ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <div id="general-settings-button">
              <Icon
                name="hamburger-menu"
                className={`${
                  disabled
                    ? 'text-brand-white'
                    : 'hover:text-brand-royalblue text-brand-white'
                }`}
              />
            </div>
          </Menu.Button>

          <div
            className={`fixed z-50 -inset-0 w-full bg-brand-black transition-all duration-300 ease-in-out ${
              open ? 'bg-opacity-50' : 'bg-opacity-0 pointer-events-none'
            }`}
          />

          {!disabled && (
            <Menu.Items
              as="div"
              className={`absolute z-50 top-6 right-[-16px] w-screen h-screen text-center text-brand-white font-poppins bg-brand-blue600 rounded-2xl focus:outline-none shadow-2xl overflow-hidden ring-1 ring-black ring-opacity-5 
              transform transition-all duration-100 ease-out ${
                open
                  ? 'opacity-100 scale-100 pointer-events-auto'
                  : 'opacity-0 scale-95 pointer-events-none'
              }`}
              static
            >
              <div className="remove-scrollbar h-full overflow-y-auto overscroll-contain pb-24">
                <AccountMenu />
                <div className="flex flex-col justify-start items-start">
                  <span className="disabled text-xs flex justify-start px-5 mt-5 mb-1">
                    {t('generalMenu.wallet')}
                  </span>

                  <Menu.Item>
                    <li
                      onClick={() => navigate('/settings/remove-eth')}
                      className="gap-2 py-1.5 cursor-pointer px-5 w-full backface-visibility-hidden flex items-center justify-start text-white text-sm font-medium hover:bg-brand-blue500 hover:bg-opacity-20 active:bg-opacity-40 focus:outline-none transition-colors duration-200"
                    >
                      <PaliWhiteSmallIconSvg className="text-brand-white" />

                      <span>{t('generalMenu.manageEth')}</span>
                    </li>
                  </Menu.Item>

                  <Menu.Item>
                    <li
                      onClick={() => navigate('/settings/seed')}
                      className="py-1.5 cursor-pointer px-5 w-full backface-visibility-hidden gap-2 flex items-center justify-start text-white text-sm font-medium hover:bg-brand-blue500 hover:bg-opacity-20 active:bg-opacity-40 focus:outline-none transition-colors duration-200"
                    >
                      <KeySvg className="mb-1 text-brand-white" />

                      <span id="wallet-seed-phrase-btn">
                        {t('generalMenu.walletSeedPhrase')}
                      </span>
                    </li>
                  </Menu.Item>

                  <Menu.Item>
                    <li
                      onClick={() => navigate('/settings/forget-wallet')}
                      className="py-1.5 cursor-pointer px-5 w-full backface-visibility-hidden gap-2 flex items-center justify-start text-white text-sm font-medium hover:bg-brand-blue500 hover:bg-opacity-20 active:bg-opacity-40 focus:outline-none transition-colors duration-200"
                    >
                      <TrashIconSvg className="mb-1 text-brand-white" />

                      <span>{t('generalMenu.forget')}</span>
                    </li>
                  </Menu.Item>
                </div>
                <div className="flex flex-col justify-start items-start">
                  <span className="disabled text-xs flex justify-start px-5 mt-5 mb-1">
                    {t('generalMenu.generalOptions')}
                  </span>

                  <Menu.Item>
                    <li
                      onClick={() => navigate('/settings/languages')}
                      className="py-1.5 gap-2 cursor-pointer px-5 w-full backface-visibility-hidden flex items-center justify-start text-white text-sm font-medium hover:bg-brand-blue500 hover:bg-opacity-20 active:bg-opacity-40 focus:outline-none transition-colors duration-200"
                    >
                      <div className="max-w-10">
                        <LanguageIconSvg
                          id="language-btn"
                          className="mb-1 text-brand-white"
                        />
                      </div>

                      <span>Languages</span>
                    </li>
                  </Menu.Item>

                  <Menu.Item>
                    <li
                      onClick={() => navigate('/settings/currency')}
                      className="gap-2 py-1.5 cursor-pointer px-5 w-full backface-visibility-hidden flex items-center justify-start text-white text-sm font-medium hover:bg-brand-blue500 hover:bg-opacity-20 active:bg-opacity-40 focus:outline-none transition-colors duration-200"
                    >
                      <DollarSignIconSvg className="text-brand-white" />

                      <span>{t('generalMenu.currency')}</span>
                    </li>
                  </Menu.Item>

                  <Menu.Item>
                    <li
                      onClick={() => navigate('/settings/about')}
                      className="gap-2 py-1.5 cursor-pointer px-5 w-full backface-visibility-hidden flex items-center justify-start text-white text-sm font-medium hover:bg-brand-blue500 hover:bg-opacity-20 active:bg-opacity-40 focus:outline-none transition-colors duration-200"
                    >
                      <HelpIconSvg
                        id="info-help-btn"
                        className="text-brand-white"
                      />

                      <span>{t('generalMenu.infoHelp')}</span>
                    </li>
                  </Menu.Item>

                  <Menu.Item>
                    <li
                      onClick={handleLogout}
                      className="gap-2 py-1.5 cursor-pointer px-5 w-full backface-visibility-hidden flex items-center justify-start text-white text-sm font-medium hover:bg-brand-blue500 hover:bg-opacity-20 active:bg-opacity-40 focus:outline-none transition-colors duration-200"
                    >
                      <LockIconSvg className="mb-2 text-brand-white" />

                      <span>{t('generalMenu.lock')}</span>
                    </li>
                  </Menu.Item>

                  <Menu.Item>
                    <li
                      onClick={() => navigate('/settings/advanced')}
                      className="gap-2 py-1.5 cursor-pointer px-5 w-full backface-visibility-hidden flex items-center justify-start text-white text-sm font-medium hover:bg-brand-blue500 hover:bg-opacity-20 active:bg-opacity-40 focus:outline-none transition-colors duration-200"
                    >
                      <img
                        src={slider}
                        width="20px"
                        className="text-brand-white"
                      />

                      <span>{t('generalMenu.advanced')}</span>
                    </li>
                  </Menu.Item>
                </div>
              </div>
            </Menu.Items>
          )}
        </>
      )}
    </Menu>
  );
};
