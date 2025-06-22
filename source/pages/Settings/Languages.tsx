import { Menu } from '@headlessui/react';
import { Form } from 'antd';
import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { ArrowDownSvg } from 'components/Icon/Icon';
import { DefaultModal, NeutralButton } from 'components/index';
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

  // Language configuration with translated names, native names, and emoji flags
  const availableLanguages = useMemo(
    () => [
      {
        id: 1,
        name: t('settings.english'),
        nativeName: 'English',
        value: PaliLanguages.EN,
        flag: '🇺🇸',
      },
      {
        id: 2,
        name: t('settings.spanish'),
        nativeName: 'Español',
        value: PaliLanguages.ES,
        flag: '🇪🇸',
      },
      {
        id: 3,
        name: t('settings.portuguese'),
        nativeName: 'Português',
        value: PaliLanguages.PT,
        flag: '🇧🇷',
      },
      {
        id: 4,
        name: t('settings.french'),
        nativeName: 'Français',
        value: PaliLanguages.FR,
        flag: '🇫🇷',
      },
      {
        id: 5,
        name: t('settings.german'),
        nativeName: 'Deutsch',
        value: PaliLanguages.DE,
        flag: '🇩🇪',
      },
      {
        id: 6,
        name: t('settings.chinese'),
        nativeName: '中文',
        value: PaliLanguages.ZH,
        flag: '🇨🇳',
      },
      {
        id: 7,
        name: t('settings.japanese'),
        nativeName: '日本語',
        value: PaliLanguages.JA,
        flag: '🇯🇵',
      },
      {
        id: 8,
        name: t('settings.korean'),
        nativeName: '한국어',
        value: PaliLanguages.KO,
        flag: '🇰🇷',
      },
      {
        id: 9,
        name: t('settings.russian'),
        nativeName: 'Русский',
        value: PaliLanguages.RU,
        flag: '🇷🇺',
      },
    ],
    [t]
  );

  const navigate = useNavigate();

  const onSubmit = async () => {
    await setLanguageInLocalStorage(currentLang);
    await i18next.changeLanguage(currentLang);
    setConfirmed(true);
  };

  const handleLanguageChange = (langValue: PaliLanguages) => {
    setCurrentLang(langValue);
  };

  const selectedLanguage = availableLanguages.find(
    (lang) => lang.value === currentLang
  );

  return (
    <>
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
        name="language-form"
        id="language-form"
        onFinish={onSubmit}
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 16 }}
        autoComplete="off"
      >
        <div className="flex flex-col gap-y-4 w-full max-w-md">
          <p className="mb-2 text-left text-white text-sm">
            {/* Keep "Languages" in English for accessibility */}
            {t('generalMenu.languages')} / Languages
          </p>

          <Menu as="div" className="relative inline-block text-left">
            {({ open }) => (
              <>
                <Menu.Button className="inline-flex justify-between p-[10px] w-full h-[44px] text-white text-sm font-light bg-brand-blue600 border border-alpha-whiteAlpha300 focus:border-fields-input-borderfocus rounded-[10px]">
                  <div className="flex items-center gap-2 ml-2">
                    <span className="text-lg">{selectedLanguage?.flag}</span>
                    <div className="flex flex-col items-start">
                      <span className="text-sm font-medium">
                        {selectedLanguage?.name}
                      </span>
                      <span className="text-xs text-brand-gray200">
                        {selectedLanguage?.nativeName}
                      </span>
                    </div>
                  </div>
                  <ArrowDownSvg />
                </Menu.Button>

                <Menu.Items
                  as="div"
                  className={`scrollbar-styled absolute z-10 px-4 py-5 w-full max-h-80 text-brand-white font-poppins bg-brand-blue600 border border-fields-input-border rounded-[10px] shadow-2xl overflow-auto origin-top-right
                  transform transition-all duration-100 ease-out ${
                    open
                      ? 'opacity-100 scale-100 pointer-events-auto'
                      : 'opacity-0 scale-95 pointer-events-none'
                  }`}
                  static
                >
                  {availableLanguages.map((lang) => (
                    <Menu.Item as="div" key={lang.id}>
                      <button
                        onClick={() => handleLanguageChange(lang.value)}
                        className={`group flex gap-x-3 items-center justify-start px-4 py-3 w-full hover:text-brand-royalbluemedium text-brand-white font-poppins text-sm border-0 border-b border-dashed border-border-default transition-all duration-300 ${
                          currentLang === lang.value
                            ? 'text-brand-royalbluemedium'
                            : ''
                        }`}
                      >
                        <span className="text-lg flex-shrink-0">
                          {lang.flag}
                        </span>
                        <div className="flex flex-col items-start text-left">
                          <span className="text-sm font-medium">
                            {lang.name}
                          </span>
                          <span className="text-xs text-brand-gray200">
                            {lang.nativeName}
                          </span>
                        </div>
                        {currentLang === lang.value && (
                          <span className="ml-auto text-brand-royalbluemedium">
                            ✓
                          </span>
                        )}
                      </button>
                    </Menu.Item>
                  ))}
                </Menu.Items>
              </>
            )}
          </Menu>
        </div>

        <div className="absolute bottom-12 md:static">
          <NeutralButton type="submit">{t('buttons.save')}</NeutralButton>
        </div>
      </Form>
    </>
  );
};

export default Languages;
