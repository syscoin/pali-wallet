import { Form } from 'antd';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { Layout, Button } from 'components/index';
import { TimeSetSuccessfuly } from 'components/Modal/WarningBaseModal';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

const AutolockView = () => {
  const { isTimerEnabled } = useSelector((state: RootState) => state.vault);
  const timer = useSelector((state: RootState) => state.vault.timer);
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [isEnabled, setIsEnabled] = useState<boolean>(isTimerEnabled);
  const [loading, setLoading] = useState<boolean>(false);
  const [form] = Form.useForm();
  const [inputValue, setInputValue] = useState(timer);

  const handleMaxClick = () => {
    setInputValue(120);
    form.setFieldsValue({ minutes: 120 });
  };

  const handleMinClick = () => {
    setInputValue(5);
    form.setFieldsValue({ minutes: 5 });
  };

  const controller = getController();
  const navigate = useNavigate();

  const onSubmit = (data: any) => {
    try {
      setLoading(true);
      const autolockMinutes = +data.minutes;

      if (autolockMinutes < 5 || autolockMinutes > 120) {
        throw new Error('Value must be between 5 and 120');
      }
      controller.wallet.setAutolockTimer(+data.minutes);
      controller.wallet.setIsAutolockEnabled(isEnabled);

      setConfirmed(true);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e) => {
    setInputValue(e.target.value);
  };

  return (
    <Layout title={t('settings.autolockTitle')} id="auto-lock-timer-title">
      <div className="flex items-start justify-start w-full">
        <p className="mb-6 text-white text-sm">
          {t('settings.setAutoLockTime')}
        </p>
      </div>
      <TimeSetSuccessfuly
        show={confirmed}
        onClose={() => {
          setConfirmed(false);
          navigate('/home');
        }}
        title={t('settings.timeSetSuccessfully')}
        phraseOne={t('settings.yourAutolockWasConfigured')}
      />

      <Form
        validateMessages={{ default: '' }}
        className="flex flex-col"
        name="autolock"
        form={form}
        id="autolock"
        onFinish={onSubmit}
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 16 }}
        initialValues={{ minutes: inputValue }}
        autoComplete="off"
      >
        <Form.Item name="minutes" className=" bg-transparent" hasFeedback>
          <div className="relative">
            <span
              onClick={handleMaxClick}
              className="absolute bottom-[11px] left-[22px] text-xs h-[18px] border border-alpha-whiteAlpha300 px-2 py-[2px] w-[41px] flex items-center justify-center rounded-[100px]"
            >
              MAX
            </span>
            <input
              type="number"
              placeholder={t('settings.minutes')}
              className="custom-autolock-input"
              value={inputValue}
              onChange={handleInputChange}
            />
            <p
              onClick={handleMinClick}
              className="absolute bottom-[11px] right-[25px] text-xs"
            >
              min
            </p>
          </div>
        </Form.Item>

        <div className="flex flex-col justify-start items-start my-6 text-sm text-brand-gray200">
          <p>{t('settings.defaultMinutes')}</p>
          <p>{t('settings.maximumMinutes')}</p>
        </div>

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
          <div className="flex flex-row gap-2 align-center justify-between w-full">
            <span className="text-sm">{t('settings.enableAutolock')}</span>
            <div
              className={`relative inline-flex items-center w-[33.5px] h-[17px] border border-white rounded-full cursor-pointer bg-transparent`}
              onClick={() => setIsEnabled(!isEnabled)}
            >
              <span
                className={`inline-block w-[0.6rem] h-[0.6rem] transform rounded-full ${
                  isEnabled
                    ? 'translate-x-[18px] bg-brand-green'
                    : 'translate-x-[4px] bg-extraColors-red'
                } transition-transform`}
              />
            </div>
          </div>
        </Form.Item>

        <div className="relative bottom-[-11rem] md:static">
          <Button
            className="flex items-center justify-center w-full h-10 bg-white text-brand-blue400 text-base font-medium rounded-[100px]"
            type="submit"
            loading={loading}
          >
            {t('buttons.save')}
          </Button>
        </div>
      </Form>
    </Layout>
  );
};

export default AutolockView;
