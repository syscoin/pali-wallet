import { Form, Input } from 'antd';
import { useForm } from 'antd/lib/form/Form';
import { QRCodeSVG } from 'qrcode.react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';

import { KeyringAccountType } from '@pollum-io/sysweb3-keyring';

import { Icon, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { HardWallets } from 'scripts/Background/controllers/message-handler/types';
import { ellipsis } from 'utils/format';
import { navigateBack } from 'utils/navigationState';

const EditAccountView = () => {
  const location = useLocation();
  const { state } = location;
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const { alert, navigate, useCopyClipboard } = useUtils();
  const [copied, copyText] = useCopyClipboard();

  const { controllerEmitter } = useController();

  const [form] = useForm();

  const getWalletType = useMemo(() => {
    if (state.isTrezorWallet) {
      return HardWallets.TREZOR;
    } else if (state.isLedgerWallet) {
      return HardWallets.LEDGER;
    } else if (state.isImported) {
      return 'Imported';
    }
    return 'Pali';
  }, [state]);

  const initialValues = {
    label: state && state.label ? state.label : '',
  };

  const onSubmit = async (data: { label: string }) => {
    setLoading(true);

    try {
      const accountType = state.isImported
        ? KeyringAccountType.Imported
        : state.isTrezorWallet
        ? KeyringAccountType.Trezor
        : state.isLedgerWallet
        ? KeyringAccountType.Ledger
        : KeyringAccountType.HDAccount;

      const accountId = state.id;

      controllerEmitter(
        ['wallet', 'editAccountLabel'],
        [data.label, accountId, accountType]
      );

      alert.success(t('settings.accountLabelEditedSuccessfully'));
      setTimeout(() => navigateBack(navigate, location), 1800);
    } catch (error) {
      alert.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyToClipboard = () => {
    copyText(state.address);
  };

  return (
    <>
      <Form
        form={form}
        validateMessages={{ default: '' }}
        id="edit-account"
        name="edit-account"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={initialValues}
        onFinish={onSubmit}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center text-center"
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
            <div className="text-xs ml-2 px-2 py-0.5 text-brand-blue100 bg-brand-blue500 rounded-full">
              {getWalletType}
            </div>
            <p className="text-xs">({ellipsis(state.address, 12, 14)})</p>
          </div>
          <div>
            <div className="flex w-full flex-col z-20">
              {copied ? (
                <div className="flex w-full gap-1 items-center cursor-pointer hover:cursor-pointer">
                  <Icon isSvg className="w-4" name="greenCheck" />

                  <p className="text-sm text-white">Copied!</p>
                </div>
              ) : (
                <div
                  className="flex w-full gap-1 items-center cursor-pointer hover:cursor-pointer"
                  onClick={() => {
                    handleCopyToClipboard();
                  }}
                >
                  <Icon isSvg className="w-4" name="Copy" />
                  <p className="text-sm text-white">Copy</p>
                </div>
              )}
            </div>{' '}
          </div>
        </div>
        <Form.Item
          name="label"
          className="md:w-full"
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

                return Promise.reject();
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

        <div className="w-full px-4 absolute bottom-12 md:static">
          <NeutralButton type="submit" fullWidth loading={loading}>
            {t('buttons.save')}
          </NeutralButton>
        </div>
      </Form>
    </>
  );
};

export default EditAccountView;
