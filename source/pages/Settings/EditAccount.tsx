import { Form, Input } from 'antd';
import { useForm } from 'antd/lib/form/Form';
import { QRCodeSVG } from 'qrcode.react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { LockIconSvg } from 'components/Icon/Icon';
import { Button, Icon } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { HardWallets } from 'scripts/Background/controllers/message-handler/types';
import { KeyringAccountType } from 'types/network';
import { ellipsis } from 'utils/format';
import { navigateBack, navigateWithContext } from 'utils/navigationState';

const EditAccountView = () => {
  const location = useLocation();
  const { state } = location;
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const { alert, navigate, useCopyClipboard } = useUtils();
  const [copied, copyText] = useCopyClipboard();

  const { controllerEmitter } = useController();

  const [form] = useForm();

  const isSmartAccount =
    state.accountType === KeyringAccountType.SmartAccount ||
    state.isSmartAccount;

  const getWalletType = useMemo(() => {
    if (isSmartAccount) {
      return 'Smart Account';
    } else if (state.isTrezorWallet) {
      return HardWallets.TREZOR;
    } else if (state.isLedgerWallet) {
      return HardWallets.LEDGER;
    } else if (state.isImported) {
      return 'Imported';
    }
    return 'Pali';
  }, [isSmartAccount, state]);

  const walletTypeBadgeClassName = isSmartAccount
    ? 'bg-purple-500 text-white'
    : 'bg-brand-blue500 text-brand-blue100';

  const initialValues = {
    label: state && state.label ? state.label : '',
  };

  const onSubmit = async (data: { label: string }) => {
    setLoading(true);

    try {
      const accountType =
        state.accountType ||
        (state.isImported
          ? KeyringAccountType.Imported
          : state.isTrezorWallet
          ? KeyringAccountType.Trezor
          : state.isLedgerWallet
          ? KeyringAccountType.Ledger
          : state.isSmartAccount
          ? KeyringAccountType.SmartAccount
          : KeyringAccountType.HDAccount);

      const accountId = state.id;

      await controllerEmitter(
        ['wallet', 'editAccountLabel'],
        [data.label, accountId, accountType]
      );

      alert.success(t('settings.accountLabelEditedSuccessfully'));
      navigateBack(navigate, location);
    } catch (error) {
      alert.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyToClipboard = () => {
    copyText(state.address);
  };

  const openSmartAccountPolicy = () => {
    navigateWithContext(
      navigate,
      '/settings/account/smart-account-policy',
      state,
      {
        returnRoute: '/settings/edit-account',
        returnContext: state.returnContext,
        state,
      }
    );
  };

  return (
    <>
      <Form
        form={form}
        validateMessages={{ default: '' }}
        id="edit-account"
        name="edit-account"
        initialValues={initialValues}
        onFinish={onSubmit}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center pb-20 text-center md:pb-0 w-full"
      >
        <QRCodeSVG
          value={state.address}
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
        <div className="flex w-full items-center mb-3 mt-2 justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`text-xs ml-2 px-2 py-0.5 rounded-full ${walletTypeBadgeClassName}`}
            >
              {getWalletType}
            </div>
            <p className="text-xs">({ellipsis(state.address, 12, 14)})</p>
          </div>
          <div>
            <div className="flex w-full flex-col z-20">
              {copied ? (
                <div className="flex w-full gap-1 items-center cursor-pointer hover:cursor-pointer">
                  <Icon isSvg className="w-4" name="greenCheck" />

                  <p className="text-sm text-white">{t('components.copied')}</p>
                </div>
              ) : (
                <div
                  className="flex w-full gap-1 items-center cursor-pointer hover:cursor-pointer"
                  onClick={() => {
                    handleCopyToClipboard();
                  }}
                >
                  <Icon isSvg className="w-4" name="Copy" />
                  <p className="text-sm text-white">{t('buttons.copy')}</p>
                </div>
              )}
            </div>{' '}
          </div>
        </div>
        <Form.Item
          name="label"
          className="w-full"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
            },
            () => ({
              async validator(_, value) {
                if (value && value.length > 0 && value !== state.label) {
                  return Promise.resolve();
                }

                return Promise.reject(
                  new Error(
                    'Label must be non-empty and different from current label'
                  )
                );
              },
            }),
          ]}
        >
          <Input
            type="text"
            placeholder={t('settings.accountLabel')}
            className="custom-edit-input relative"
          />
        </Form.Item>

        {isSmartAccount && (
          <button
            type="button"
            className="mb-4 flex w-full cursor-pointer items-center justify-between rounded-lg bg-alpha-whiteAlpha100 px-4 py-4 text-left text-sm hover:bg-brand-blue500 hover:bg-opacity-20"
            onClick={openSmartAccountPolicy}
          >
            <span className="flex min-w-0 items-center gap-3">
              <LockIconSvg className="shrink-0 w-6 h-6 text-white opacity-90" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-white">
                  {t('settings.smartAccountAccountPolicy')}
                </span>
                <span className="mt-1 block text-xs text-brand-graylight">
                  {t('settings.smartAccountAccountPolicySummary')}
                </span>
              </span>
            </span>
            <Icon name="arrowright" isSvg size={24} className="shrink-0" />
          </button>
        )}

        <div
          className={`w-full px-4 ${
            isSmartAccount ? 'static' : 'absolute bottom-12 md:static'
          }`}
        >
          <Button
            variant="neutral"
            className="text-sm text-brand-royalblue"
            type="submit"
            fullWidth
            loading={loading}
          >
            {t('buttons.save')}
          </Button>
        </div>
      </Form>
    </>
  );
};

export default EditAccountView;
