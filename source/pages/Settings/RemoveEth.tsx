import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';

import { Button, DefaultModal, Icon, PageActionFooter } from 'components/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { navigateBack } from 'utils/navigationState';

const RemoveEthView = () => {
  const { hasEthProperty } = useSelector(
    (state: RootState) => state.vaultGlobal
  );
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState<boolean | null>(null);
  const isEnabled = hasEthProperty;
  const [loading, setLoading] = useState<boolean>(false);
  const [saveError, setSaveError] = useState(false);
  const { controllerEmitter } = useController();
  const navigate = useNavigate();
  const location = useLocation();

  const onSubmit = async () => {
    if (loading) return;
    setLoading(true);
    setSaveError(false);

    try {
      switch (isEnabled) {
        case true:
          // Keep the provider enabled until its requested revocations are
          // durable, so a failed write leaves this same action retryable.
          const dapps = await controllerEmitter(['dapp', 'getAll']);
          for (const dapp of Object.values(dapps) as { host: string }[]) {
            await controllerEmitter(
              ['dapp', 'disconnect'],
              [
                dapp.host,
                true,
                { propagateErrors: true, allowAlreadyDisconnected: true },
              ]
            );
          }
          await controllerEmitter(['wallet', 'removeWindowEthProperty']);

          setConfirmed(false);
          break;
        case false:
          await controllerEmitter(['wallet', 'addWindowEthProperty']);

          setConfirmed(true);
          break;
        default:
          break;
      }
    } catch (error) {
      console.error('Error changing Ethereum provider:', error);
      setSaveError(true);
    } finally {
      setLoading(false);
    }
  };

  const icon = (
    <Icon
      name="PaliWhiteSmall"
      isSvg
      className="h-5 w-5 text-brand-gray300 opacity-80"
    />
  );

  return (
    <>
      <DefaultModal
        show={confirmed !== null}
        onClose={() => {
          setConfirmed(null);
          navigateBack(navigate, location);
        }}
        title={t(
          confirmed
            ? 'settings.paliProviderEnabled'
            : 'settings.paliProviderDisabled'
        )}
        description={t('settings.yourWalletWasConfigured')}
      />
      <div className="flex w-full min-w-0 flex-col items-center gap-[38px]">
        <div className="flex flex-col items-center text-center gap-2">
          <Icon
            wrapperClassname={'rounded-[100px] p-[15px] bg-brand-deepPink100 '}
            name="Wallet"
            isSvg
          />
          <p className="text-sm text-white">
            {t(
              isEnabled
                ? 'settings.paliProviderEnabled'
                : 'settings.paliProviderDisabled'
            )}
          </p>
        </div>

        {isEnabled && (
          <div className="flex p-4 rounded-[20px] flex-col gap-[11px] w-full border-dashed border-alpha-whiteAlpha300 bg-alpha-whiteAlpha100">
            <p className="text-xs font-medium text-white">
              {t('settings.otherDefaultWalletHelpTitle')}
            </p>
            <p className="text-xs font-normal text-white">
              {t('settings.otherDefaultWalletHelp')}
            </p>
          </div>
        )}

        <PageActionFooter error={saveError ? t('send.failed') : undefined}>
          <div className="flex w-full flex-col gap-3">
            {isEnabled && (
              <p className="text-center text-xs text-white">
                {t('settings.disablePaliProviderWarning')}
              </p>
            )}
            <button
              type="button"
              onClick={onSubmit}
              disabled={loading}
              className="flex min-h-[44px] w-full min-w-0 items-center justify-center gap-2 rounded-[100px] border-2 border-white py-2 px-3 text-sm font-medium leading-5"
            >
              <span aria-hidden="true" className="shrink-0">
                {icon}
              </span>
              <span className="min-w-0 whitespace-normal break-words">
                {t(
                  isEnabled
                    ? 'settings.disablePaliProvider'
                    : 'settings.enablePaliProvider'
                )}
              </span>
            </button>
            <Button
              variant="neutral"
              className="text-sm text-brand-royalblue"
              onClick={() => navigateBack(navigate, location)}
              type="button"
              fullWidth={true}
              loading={loading}
            >
              {t('buttons.close')}
            </Button>
          </div>
        </PageActionFooter>
      </div>
    </>
  );
};

export default RemoveEthView;
