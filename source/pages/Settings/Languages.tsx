import { Form, Radio } from 'antd';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { Layout, DefaultModal, NeutralButton } from 'components/index';
import { setLanguageInLocalstorage } from 'scripts/Background';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { i18next } from 'utils/i18n';
import { PaliLanguages } from 'utils/types';

const Languages = () => {
  const { timer, language } = useSelector((state: RootState) => state.vault);

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [currentLang, setCurrentLang] = useState<PaliLanguages>(language);
  const { t } = useTranslation();

  const [loading, setLoading] = useState<boolean>(false);

  const controller = getController();
  const navigate = useNavigate();

  const onSubmit = () => {
    setLoading(true);
    setLanguageInLocalstorage(currentLang);
    controller.wallet.setCurrentLanguage(currentLang);

    i18next.changeLanguage(currentLang);
    setConfirmed(true);
    setLoading(false);
  };

  return (
    <Layout title={t('settings.languages')} id="auto-lock-timer-title">
      <DefaultModal
        show={confirmed}
        onClose={() => {
          setConfirmed(false);
          navigate('/home');
        }}
        title={t('settings.languageWasSet')}
        description={t('settings.yourWalletWasConfigured')}
      />

      <Form
        validateMessages={{ default: '' }}
        className="flex flex-col gap-8 items-center justify-center text-center w-full"
        name="autolock"
        id="autolock"
        onFinish={onSubmit}
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 16 }}
        initialValues={{ minutes: timer }}
        autoComplete="off"
      >
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
            <Radio.Group
              className="w-full"
              onChange={(e) => setCurrentLang(e.target.value)}
              value={currentLang}
            >
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between border-b border-dashed border-gray-600 pb-2">
                  <label htmlFor="en" className="ml-2 text-sm font-light">
                    {t('settings.english')}
                  </label>

                  <Radio value={PaliLanguages.EN} name="en" id="en" />
                </div>
                <div className="flex items-center justify-between border-b border-dashed border-gray-600 pb-2">
                  <label htmlFor="es" className="ml-2 text-sm font-light ">
                    {t('settings.spanish')}
                  </label>

                  <Radio value={PaliLanguages.ES} name="es" id="es" />
                </div>
              </div>
            </Radio.Group>
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

export default Languages;
