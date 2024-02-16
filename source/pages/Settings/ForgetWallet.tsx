import { Form, Input } from 'antd';
import TextArea from 'antd/lib/input/TextArea';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Layout, Button, Card } from 'components/index';
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
      <p className="text-sm mb-6">
        {t('forgetWalletPage.importedAccountsWont')}
      </p>
      <Form
        validateMessages={{ default: '' }}
        form={form}
        onFinish={onSubmit}
        className="password flex flex-col gap-4 items-center justify-center mb-10 w-full text-center "
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
            className="custom-input-password relative focus:border-fields-input-border"
            placeholder={t('settings.enterYourPassword')}
            id="forget_password"
          />
        </Form.Item>

        {hasAccountFunds && (
          <>
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
                } bg-fields-input-primary p-2 pl-4 w-[353px] h-[90px] text-brand-graylight text-sm border border-border-default focus:border-fields-input-borderfocus rounded-[10px] outline-none resize-none`}
                placeholder={t('import.pasteYourWalletSeed')}
                id="forget_seed"
              />
            </Form.Item>
          </>
        )}
      </Form>
      <Card type="info">
        <div className="flex flex-col justify-start items-start">
          <p className="text-brand-yellowInfo text-sm font-normal text-left">
            {t('forgetWalletPage.stillHaveFunds')}
          </p>
          <p className="text-white text-sm font-normal text-left">
            {t('forgetWalletPage.saveProperly')}
          </p>
        </div>
      </Card>

      <div className="flex mt-6 gap-x-8 justify-between md:static md:gap-x-40">
        <Button
          type="button"
          onClick={() => navigate('/home')}
          className="w-[164px] h-10 flex items-center justify-center rounded-[100px] border-2 border-white text-base font-medium text-white"
        >
          {t('buttons.cancel')}
        </Button>

        <Button
          type="submit"
          className={`${
            !isPasswordValid || !isSeedValid ? 'opacity-60' : 'opacity-100'
          } w-[164px] h-10 flex items-center justify-center rounded-[100px] bg-white border-white text-base font-medium text-brand-blue400`}
          disabled={!isPasswordValid || !isSeedValid}
          id="forget-btn"
        >
          {t('buttons.forget')}
        </Button>
      </div>
    </Layout>
  );
};

export default ForgetWalletView;
