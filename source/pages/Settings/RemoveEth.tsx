import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';

import metamaskIcon from 'assets/all_assets/metamask.svg';
import { DefaultModal, NeutralButton, Icon } from 'components/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { navigateBack } from 'utils/navigationState';

const RemoveEthView = () => {
  const { hasEthProperty } = useSelector(
    (state: RootState) => state.vaultGlobal
  );
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [isEnabled, setIsEnabled] = useState<boolean>(hasEthProperty);
  const [loading, setLoading] = useState<boolean>(false);
  const { controllerEmitter } = useController();
  const navigate = useNavigate();
  const location = useLocation();

  const onSubmit = () => {
    setLoading(true);

    setIsEnabled(!isEnabled);

    switch (isEnabled) {
      case true:
        controllerEmitter(['wallet', 'removeWindowEthProperty']);

        controllerEmitter(['wallet', 'setHasEthProperty'], [false]);

        controllerEmitter(['dapp', 'getAll']).then((dapps) => {
          for (const dapp of Object.values(dapps)) {
            controllerEmitter(['dapp', 'isConnected'], [dapp.host]).then(
              (isConnected: boolean) => {
                if (isConnected)
                  controllerEmitter(['dapp', 'disconnect'], [dapp.host]);
              }
            );
          }
        });

        setConfirmed(true);
        setLoading(false);
        break;
      case false:
        controllerEmitter(['wallet', 'addWindowEthProperty']);

        controllerEmitter(['wallet', 'setHasEthProperty'], [true]);

        setConfirmed(true);

        setLoading(false);
        break;
      default:
        break;
    }
  };

  const icon = useMemo(
    () =>
      isEnabled ? (
        <img className="pr-2" src={metamaskIcon} />
      ) : (
        <Icon
          name="PaliWhiteSmall"
          isSvg
          className="pr-2 text-brand-gray300 opacity-80"
        />
      ),
    [isEnabled]
  );

  return (
    <>
      <DefaultModal
        show={confirmed}
        onClose={() => {
          setConfirmed(false);
          navigateBack(navigate, location);
        }}
        title={t('settings.windowObjectWasSet')}
        description={t('settings.yourWalletWasConfigured')}
      />
      <div className="flex flex-col items-center gap-[38px]">
        <div className="flex flex-col items-center text-center gap-2">
          <Icon
            wrapperClassname={'rounded-[100px] p-[15px] bg-brand-deepPink100 '}
            name="Wallet"
            isSvg
          />
          {!isEnabled ? (
            <p className="text-sm text-white">You are using another wallet!</p>
          ) : (
            <>
              <p className="text-sm text-white">Pali</p>
              <p className="text-sm text-brand-gray200">
                is the default wallet
              </p>
            </>
          )}
        </div>

        <button
          onClick={onSubmit}
          className="flex items-center justify-center w-[352px] border-2 border-white rounded-[100px] py-2 px-[13px] text-base font-medium"
        >
          {isEnabled ? (
            <>
              {icon}
              Set Metamask as default wallet
            </>
          ) : (
            <>
              {icon}
              Set Pali as default wallet
            </>
          )}
        </button>

        {isEnabled && (
          <div className="flex p-4 rounded-[20px] flex-col gap-[11px] w-full border-dashed border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100">
            <p className="text-xs font-medium text-white">
              How can I set other wallet as default?
            </p>
            <p className="text-xs font-normal text-white">
              Some wallets offer this option internally. The browser will always
              consider as default the last wallet installed or activated.
            </p>
          </div>
        )}

        <div className="w-full px-4 absolute bottom-12 md:static">
          <NeutralButton
            onClick={() => navigateBack(navigate, location)}
            type="button"
            fullWidth={true}
            loading={loading}
          >
            {t('buttons.close')}
          </NeutralButton>
        </div>
      </div>
    </>
  );
};

export default RemoveEthView;
