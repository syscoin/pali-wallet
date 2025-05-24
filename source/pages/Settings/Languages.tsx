import { Form } from 'antd';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import checked from 'assets/icons/greenChecked.svg';
import { DefaultModal, Layout, NeutralButton } from 'components/index';
import { setLanguageInLocalStorage } from 'scripts/Background/utils/bgActions';
import { i18next } from 'utils/i18n';
import { chromeStorage } from 'utils/storageAPI';
import { PaliLanguages } from 'utils/types';

const Languages = () => {
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [currentLang, setCurrentLang] = useState<PaliLanguages>(
    PaliLanguages.EN
  );
  const { t } = useTranslation();

  useEffect(() => {
    const fetchLanguage = async () => {
      const storedLang = await chromeStorage
        .getItem('language')
        .then((state) => JSON.parse(state));
      setCurrentLang(storedLang ?? PaliLanguages.EN);
    };

    fetchLanguage().then((lng) => lng);
  }, []);

  const availableLanguages = [
    { id: 1, name: t('settings.english'), value: PaliLanguages.EN },
    { id: 2, name: t('settings.spanish'), value: PaliLanguages.ES },
    { id: 3, name: t('settings.portuguese'), value: PaliLanguages.PT },
    { id: 4, name: t('settings.french'), value: PaliLanguages.FR },
    { id: 5, name: t('settings.german'), value: PaliLanguages.DE },
    { id: 6, name: t('settings.chinese'), value: PaliLanguages.ZH },
    { id: 7, name: t('settings.japanese'), value: PaliLanguages.JA },
    { id: 8, name: t('settings.korean'), value: PaliLanguages.KO },
    { id: 9, name: t('settings.russian'), value: PaliLanguages.RU },
  ];

  const navigate = useNavigate();

  const onSubmit = async () => {
    await setLanguageInLocalStorage(currentLang);

    await i18next.changeLanguage(currentLang);
    setConfirmed(true);
  };

  const handleLanguageChange = (e) => {
    setCurrentLang(e.target.value);
  };

  const RenderLanguages = () => (
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
              type="button"
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
  );

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
          {RenderLanguages()}
        </Form.Item>

        <div className="absolute bottom-12 md:static">
          <NeutralButton type="submit">{t('buttons.save')}</NeutralButton>
        </div>
      </Form>
    </Layout>
  );
};

export default Languages;
