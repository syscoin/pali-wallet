import { Switch } from '@headlessui/react';
import { Form, Input } from 'antd';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { Layout, DefaultModal, NeutralButton } from 'components/index';
import { getController } from 'scripts/Background';
import { RootState } from 'state/store';

const AutolockView = () => {
  const { isTimerEnabled } = useSelector((state: RootState) => state.vault);
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [isEnabled, setIsEnabled] = useState<boolean>(isTimerEnabled);
  const [loading, setLoading] = useState<boolean>(false);

  const controller = getController();
  const navigate = useNavigate();

  const timer = useSelector((state: RootState) => state.vault.timer);

  const onSubmit = (data: any) => {
    setLoading(true);

    controller.wallet.setAutolockTimer(+data.minutes);
    controller.wallet.setIsAutolockEnabled(isEnabled);

    setConfirmed(true);
    setLoading(false);
  };

  return (
    <Layout title={t('settings.autolockTitle')} id="auto-lock-timer-title">
      <p className="mb-8 text-white text-sm">
        {t('settings.youCanSetAutolock')}
      </p>

      <DefaultModal
        show={confirmed}
        onClose={() => {
          setConfirmed(false);
          navigate('/home');
        }}
        title={t('settings.timeSetSuccessfully')}
        description={t('settings.yourAutolockWasConfigured')}
      />

      <Form
        validateMessages={{ default: '' }}
        className="flex flex-col gap-8 items-center justify-center text-center"
        name="autolock"
        id="autolock"
        onFinish={onSubmit}
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 16 }}
        initialValues={{ minutes: `${timer}` }}
        autoComplete="off"
      >
        <Form.Item
          name="minutes"
          className="w-full"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
              min: 1,
              max: 120,
            },
            () => ({
              validator(_, value) {
                if (+value <= 120 && +value >= 1) {
                  return Promise.resolve();
                }

                return Promise.reject();
              },
            }),
          ]}
        >
          <Input
            type="number"
            placeholder={t('settings.minutes')}
            className="input-small relative"
          />
        </Form.Item>

        <Form.Item
          id="verify-address-switch"
          name="verify"
          className="flex flex-col w-full text-center"
          rules={[
            {
              required: false,
              message: '',
            },
          ]}
        >
          <div className="align-center flex flex-row gap-2 justify-center w-full text-center">
            <span className="text-sm">{t('settings.enableAutolock')}</span>
            <Switch
              checked={isEnabled}
              onChange={() => setIsEnabled(!isEnabled)}
              className="relative inline-flex items-center w-9 h-5 border border-brand-royalblue rounded-full"
              style={{ margin: '0 auto !important' }}
            >
              <span
                className={`${
                  isEnabled
                    ? 'translate-x-6 bg-warning-success'
                    : 'translate-x-1'
                } inline-block w-2 h-2 transform bg-warning-error rounded-full`}
              />
            </Switch>
          </div>
        </Form.Item>

        <div className="absolute bottom-12 md:static">
          <NeutralButton type="submit" loading={loading}>
            {t('buttons.save')}
          </NeutralButton>
        </div>
      </Form>
    </Layout>
  );
};

export default AutolockView;
