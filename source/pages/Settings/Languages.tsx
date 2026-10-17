import { Menu } from '@headlessui/react';
import { Form } from 'antd';
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';

import { ArrowDownSvg } from 'components/Icon/Icon';
import { Button, DefaultModal, PageActionFooter } from 'components/index';
import { changeLanguage } from 'utils/i18n';
import { navigateBack } from 'utils/navigationState';
import { chromeStorage } from 'utils/storageAPI';
import { PaliLanguages } from 'utils/types';

const Languages = () => {
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const savingRef = useRef(false);
  const draftEdited = useRef(false);
  const saveRevision = useRef(0);
  const [savedLang, setSavedLang] = useState<PaliLanguages>(PaliLanguages.EN); // Actually saved language
  const [selectedLang, setSelectedLang] = useState<PaliLanguages>(
    PaliLanguages.EN
  ); // Preview selection
  const { t } = useTranslation();

  useEffect(() => {
    let active = true;
    const revision = saveRevision.current;
    const fetchLanguage = async () => {
      const storedLang = await chromeStorage
        .getItem('language')
        .then((state) => state);
      if (!active || saveRevision.current !== revision) return;
      const currentLang = storedLang ?? PaliLanguages.EN;
      setSavedLang(currentLang);
      // The initial read must not replace a choice already made in this form.
      if (!draftEdited.current) setSelectedLang(currentLang);
    };

    void fetchLanguage().catch(() => undefined);
    return () => {
      active = false;
    };
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
    if (savingRef.current || selectedLang === savedLang) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(false);
    try {
      await changeLanguage(selectedLang);
      saveRevision.current += 1;
      setSavedLang(selectedLang);
      setConfirmed(true);
    } catch {
      setSaveError(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleLanguageChange = (langValue: PaliLanguages) => {
    // Only update preview state - don't save yet
    draftEdited.current = true;
    setSelectedLang(langValue);
    setSaveError(false);
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
        autoComplete="off"
      >
        <div className="flex w-full max-w-[352px] flex-col gap-y-6">
          <p className="mb-2 text-left text-white text-sm">
            {t('settings.setYourPreferredLanguage')}
          </p>

          <Menu as="div" className="relative inline-block w-full text-left">
            {({ open }) => (
              <>
                <Menu.Button
                  disabled={saving}
                  aria-label={t('settings.setYourPreferredLanguage')}
                  className="inline-flex justify-between p-[10px] w-full h-[44px] text-white text-sm font-light bg-brand-blue600 border border-alpha-whiteAlpha300 focus:border-fields-input-borderfocus rounded-[10px] hover:bg-brand-blue500 hover:bg-opacity-20 transition-all duration-200 group"
                >
                  <div className="flex items-center gap-2 ml-2">
                    <span className="text-lg transform transition-transform duration-300 group-hover:scale-110">
                      {selectedLanguage?.flag}
                    </span>
                    <div className="flex flex-col items-start">
                      <span className="text-sm font-medium">
                        {selectedLanguage?.name}
                      </span>
                      <span className="text-xs text-brand-gray200">
                        {selectedLanguage?.nativeName}
                      </span>
                    </div>
                  </div>
                  <ArrowDownSvg
                    className={`transform transition-transform duration-200 ${
                      open ? 'rotate-180' : ''
                    }`}
                  />
                </Menu.Button>

                <Menu.Items
                  as="div"
                  className={`scrollbar-styled absolute z-10 px-4 py-5 w-full max-h-80 text-brand-white font-poppins bg-brand-blue600 border border-fields-input-border rounded-[10px] shadow-2xl overflow-auto origin-top-right
                  transform transition-all duration-100 ease-out ${
                    open
                      ? 'opacity-100 scale-100 pointer-events-auto'
                      : 'opacity-0 scale-95 pointer-events-none'
                  }`}
                >
                  {availableLanguages.map((lang) => (
                    <Menu.Item key={lang.id}>
                      <button
                        type="button"
                        aria-label={`${lang.name} ${lang.nativeName}`}
                        onClick={() => handleLanguageChange(lang.value)}
                        className={`group flex gap-x-3 items-center justify-start px-4 py-3 w-full hover:text-brand-royalbluemedium text-brand-white font-poppins text-sm border-0 border-b border-dashed border-border-default transition-all duration-200 hover:bg-brand-blue500 hover:bg-opacity-20 rounded-lg ${
                          selectedLang === lang.value
                            ? 'text-brand-royalbluemedium bg-brand-blue500 bg-opacity-20'
                            : ''
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`text-lg flex-shrink-0 transform transition-transform duration-200 group-hover:scale-110 ${
                            selectedLang === lang.value ? 'scale-110' : ''
                          }`}
                        >
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

          <div className="bg-brand-blue800 rounded-lg p-6 border border-brand-blue600 hover:border-brand-blue500 transition-all duration-200 group">
            <p className="text-brand-gray200 text-xs mb-4 text-center">
              {t('settings.currentLanguage')}
            </p>
            <div className="flex items-center justify-center gap-6">
              <span className="text-6xl transform transition-transform duration-200 group-hover:scale-110">
                {currentLanguage?.flag}
              </span>
              <div className="flex flex-col items-start">
                <span className="text-xl font-medium text-white">
                  {currentLanguage?.name}
                </span>
                <span className="text-sm text-brand-gray200 mt-1">
                  {currentLanguage?.nativeName}
                </span>
              </div>
            </div>
            {hasUnsavedChanges && selectedLang !== savedLang && (
              <div className="mt-4 text-center">
                <p className="text-xs text-brand-royalblue300">
                  {t('settings.previewLanguage', {
                    language: selectedLanguage?.nativeName,
                  })}
                </p>
              </div>
            )}
          </div>
        </div>

        <PageActionFooter
          error={saveError ? t('settings.preferencesSaveFailed') : undefined}
        >
          <Button
            variant="neutral"
            className="text-sm text-brand-royalblue"
            type="submit"
            fullWidth
            disabled={!hasUnsavedChanges || saving}
            loading={saving}
          >
            {t('buttons.save')}
          </Button>
        </PageActionFooter>
      </Form>
    </>
  );
};

export default Languages;
