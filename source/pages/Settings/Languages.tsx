import { Menu } from '@headlessui/react';
import { Form } from 'antd';
import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';

import { ArrowDownSvg } from 'components/Icon/Icon';
import { DefaultModal, NeutralButton } from 'components/index';
import { setLanguageInLocalStorage } from 'scripts/Background/utils/bgActions';
import { i18next } from 'utils/i18n';
import { navigateBack } from 'utils/navigationState';
import { chromeStorage } from 'utils/storageAPI';
import { PaliLanguages } from 'utils/types';

const Languages = () => {
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [savedLang, setSavedLang] = useState<PaliLanguages>(PaliLanguages.EN); // Actually saved language
  const [selectedLang, setSelectedLang] = useState<PaliLanguages>(
    PaliLanguages.EN
  ); // Preview selection
  const { t } = useTranslation();

  useEffect(() => {
    const fetchLanguage = async () => {
      const storedLang = await chromeStorage
        .getItem('language')
        .then((state) => state);
      const currentLang = storedLang ?? PaliLanguages.EN;
      setSavedLang(currentLang);
      setSelectedLang(currentLang); // Initialize preview with saved value
    };

    fetchLanguage().then((lng) => lng);
  }, []);

  // Language configuration with static names to avoid t() dependency issues
  const availableLanguages = useMemo(
    () => [
      {
        id: 1,
        name: 'English',
        nativeName: 'English',
        value: PaliLanguages.EN,
        flag: '🇺🇸',
      },
      {
        id: 2,
        name: 'Spanish',
        nativeName: 'Español',
        value: PaliLanguages.ES,
        flag: '🇪🇸',
      },
      {
        id: 3,
        name: 'Portuguese',
        nativeName: 'Português',
        value: PaliLanguages.PT,
        flag: '🇧🇷',
      },
      {
        id: 4,
        name: 'French',
        nativeName: 'Français',
        value: PaliLanguages.FR,
        flag: '🇫🇷',
      },
      {
        id: 5,
        name: 'German',
        nativeName: 'Deutsch',
        value: PaliLanguages.DE,
        flag: '🇩🇪',
      },
      {
        id: 6,
        name: 'Chinese',
        nativeName: '中文',
        value: PaliLanguages.ZH,
        flag: '🇨🇳',
      },
      {
        id: 7,
        name: 'Japanese',
        nativeName: '日本語',
        value: PaliLanguages.JA,
        flag: '🇯🇵',
      },
      {
        id: 8,
        name: 'Korean',
        nativeName: '한국어',
        value: PaliLanguages.KO,
        flag: '🇰🇷',
      },
      {
        id: 9,
        name: 'Russian',
        nativeName: 'Русский',
        value: PaliLanguages.RU,
        flag: '🇷🇺',
      },
    ],
    [] // Remove t dependency
  );

  const navigate = useNavigate();
  const location = useLocation();

  const onSubmit = async () => {
    // Only save when explicitly clicking save button
    await setLanguageInLocalStorage(selectedLang);
    await i18next.changeLanguage(selectedLang);
    setSavedLang(selectedLang); // Update saved state
    setConfirmed(true);
  };

  const handleLanguageChange = (langValue: PaliLanguages) => {
    // Only update preview state - don't save yet
    setSelectedLang(langValue);
  };

  const selectedLanguage = availableLanguages.find(
    (lang) => lang.value === selectedLang
  );

  const currentLanguage = availableLanguages.find(
    (lang) => lang.value === savedLang
  );

  // Check if there are unsaved changes
  const hasUnsavedChanges = selectedLang !== savedLang;

  return (
    <>
      <DefaultModal
        show={confirmed}
        onClose={() => {
          setConfirmed(false);
          navigateBack(navigate, location);
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
        <div className="flex flex-col gap-y-6">
          <p className="mb-2 text-left text-white text-sm">
            {t('settings.setYourPreferredLanguage')}
          </p>

          <Menu as="div" className="relative inline-block text-left w-[352px]">
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
                        type="button"
                        onClick={() => handleLanguageChange(lang.value)}
                        className={`group flex gap-x-3 items-center justify-start px-4 py-3 w-full hover:text-brand-royalbluemedium text-brand-white font-poppins text-sm border-0 border-b border-dashed border-border-default transition-all duration-300 ${
                          selectedLang === lang.value
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
                        {selectedLang === lang.value && (
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

          <div className="bg-brand-blue800 rounded-lg p-6">
            <p className="text-brand-gray200 text-xs mb-4 text-center">
              Current Language
            </p>
            <div className="flex items-center justify-center gap-6">
              <span className="text-6xl">{currentLanguage?.flag}</span>
              <div className="flex flex-col items-start">
                <span className="text-xl font-medium text-white">
                  {currentLanguage?.name}
                </span>
                <span className="text-sm text-brand-gray200 mt-1">
                  {currentLanguage?.nativeName}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="w-full px-4 absolute bottom-12 md:static">
          <NeutralButton type="submit" fullWidth disabled={!hasUnsavedChanges}>
            Save
          </NeutralButton>
        </div>
      </Form>
    </>
  );
};

export default Languages;
