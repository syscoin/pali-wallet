import { Form } from 'antd';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import checked from 'assets/icons/greenChecked.svg';
import { Layout, DefaultModal } from 'components/index';
import { setLanguageInLocalstorage } from 'scripts/Background';
import { RootState } from 'state/store';
import { i18next } from 'utils/i18n';
import { PaliLanguages } from 'utils/types';

const Languages = () => {
  const { timer } = useSelector((state: RootState) => state.vault);

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const currLang = window.localStorage.getItem('language');
  const [currentLang, setCurrentLang] = useState<PaliLanguages>(
    (currLang ?? 'en') as PaliLanguages
  );
  const { t } = useTranslation();

  const availableLanguages = [
    { id: 1, name: t('settings.english'), value: PaliLanguages.EN },
    { id: 2, name: t('settings.spanish'), value: PaliLanguages.ES },
  ];

  const navigate = useNavigate();

  const onSubmit = () => {
    setLanguageInLocalstorage(currentLang);

    i18next.changeLanguage(currentLang);
    setConfirmed(true);
  };

  const handleLanguageChange = (e) => {
    setCurrentLang(e.target.value);
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
            <div className="flex flex-col gap-4 w-full">
              {availableLanguages.map((lng) => (
                <div
                  key={lng.id}
                  className="flex items-center justify-between border-b border-dashed border-gray-600 pb-2"
                  onClick={(e) => handleLanguageChange(e)}
                >
                  <button
                    value={lng.value}
                    className="bg-transparent text-sm font-light"
                  >
                    {lng.name}
                  </button>
                  {currentLang === lng.value && (
                    <img src={checked} alt={`Selected: ${lng.name}`} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </Form.Item>
      </Form>
    </Layout>
  );
};

export default Languages;
