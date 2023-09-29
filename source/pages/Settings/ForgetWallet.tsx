import { Form, Input } from 'antd';
import TextArea from 'antd/lib/input/TextArea';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Layout, SecondaryButton, PrimaryButton, Card } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

const ForgetWalletView = () => {
  const { navigate } = useUtils();
  const { t } = useTranslation();
  const controller = getController();
  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );
  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];

  if (!activeAccount) throw new Error('No active account');

  const hasAccountFunds =
    (isBitcoinBased
      ? activeAccount.balances.syscoin
      : activeAccount.balances.ethereum) > 0;

  // if account has no funds, no need to input the seed
  const [isSeedValid, setIsSeedValid] = useState<boolean>(!hasAccountFunds);
  const [isPasswordValid, setIsPasswordValid] = useState<boolean>(false);

  const onSubmit = ({ password }: { password: string }) => {
    controller.wallet.forgetWallet(password);

    navigate('/');
  };

  const [form] = Form.useForm();

  return (
    <Layout title={t('menus.forget')}>
      <Card type="info">
        <p>
          <b className="text-warning-info">{t('settings.forgetWarning')}:</b>{' '}
          {t('settings.thisWillForget')}
        </p>
      </Card>

      <div className="flex flex-col items-center justify-center w-full">
        <Form
          validateMessages={{ default: '' }}
          form={form}
          onFinish={onSubmit}
          className="password flex flex-col gap-5 items-center justify-center my-5 w-full max-w-xs text-center md:max-w-md"
          name="forget"
          autoComplete="off"
        >
          <Form.Item
            name="password"
            hasFeedback
            className="w-full"
            rules={[
              {
                required: true,
                message: '',
              },
              () => ({
                validator(_, value) {
                  const seed = controller.wallet.getSeed(value);

                  if (seed) {
                    setIsPasswordValid(true);

                    return Promise.resolve();
                  }

                  setIsPasswordValid(false);

                  return Promise.reject();
                },
              }),
            ]}
          >
            <Input.Password
              className="input-small relative"
              placeholder={t('settings.enterYourPassword')}
              id="forget_password"
            />
          </Form.Item>

          {hasAccountFunds && (
            <>
              <p className="max-w-xs text-left text-xs leading-4 md:max-w-md">
                {t('settings.youStillHave')}
              </p>

              <Form.Item
                name="seed"
                className="w-full"
                dependencies={['password']}
                rules={[
                  {
                    required: true,
                    message: '',
                  },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      const seed = controller.wallet.getSeed(
                        getFieldValue('password')
                      );

                      if (seed === value) {
                        setIsSeedValid(true);

                        return Promise.resolve();
                      }

                      setIsSeedValid(false);

                      return Promise.reject();
                    },
                  }),
                ]}
              >
                <TextArea
                  className={`${
                    !isSeedValid && form.getFieldValue('seed')
                      ? 'border-warning-error'
                      : 'border-fields-input-border'
                  } bg-fields-input-primary p-2 pl-4 w-full h-20 text-brand-graylight text-sm border focus:border-fields-input-borderfocus rounded-lg outline-none resize-none`}
                  placeholder={t('import.pasteYourWalletSeed')}
                  id="forget_seed"
                />
              </Form.Item>
            </>
          )}

          <div className="flex gap-x-8 justify-between md:static md:gap-x-40">
            <PrimaryButton type="button" onClick={() => navigate('/home')}>
              {t('buttons.cancel')}
            </PrimaryButton>

            <SecondaryButton
              type="submit"
              disabled={!isPasswordValid || !isSeedValid}
              id="forget-btn"
            >
              {t('buttons.forget')}
            </SecondaryButton>
          </div>
        </Form>
      </div>
    </Layout>
  );
};

export default ForgetWalletView;
