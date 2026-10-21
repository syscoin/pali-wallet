import { Switch } from '@headlessui/react';
import { Form } from 'antd';
import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';

import {
  Button,
  ConfirmationModal,
  DefaultModal,
  PageActionFooter,
} from 'components/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { getWalletNavigationScope, navigateBack } from 'utils/navigationState';

import { SmartAccountInfrastructure } from './SmartAccountInfrastructure';

const Advanced = () => {
  const { advancedSettings } = useSelector(
    (state: RootState) => state.vaultGlobal
  );
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [enabledProperties, setEnabledProperties] = useState<{
    [k: string]: boolean | number | undefined;
  }>({
    ...advancedSettings,
  });
  const [savedProperties, setSavedProperties] = useState<{
    [k: string]: boolean | number | undefined;
  }>({
    ...advancedSettings,
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [saveError, setSaveError] = useState(false);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const submissionId = useRef(0);
  const draftEdited = useRef(false);
  const [confirmationMessage, setConfirmationMessage] = useState<string>('');
  const [currentAdvancedProperty, setCurrentAdvancedProperty] =
    useState<string>('');
  const [isOpenConfirmationModal, setIsOpenConfirmationModal] =
    useState<boolean>(false);
  const { controllerEmitter } = useController();
  const navigate = useNavigate();
  const location = useLocation();
  const walletScope = useSelector(() => getWalletNavigationScope());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      submissionId.current += 1;
    };
  }, []);

  useEffect(() => {
    submissionId.current += 1;
    submitting.current = false;
    setLoading(false);
    setConfirmed(false);
    setSaveError(false);
  }, [walletScope.account, walletScope.network]);

  const ADVANCED_SETTINGS = ['refresh', 'autolock'];

  const settingsTitles = {
    refresh: t('settings.enableRefresh'),
    autolock: t('settings.enableAutolock'),
  };

  const settingsWarnings = {
    refresh: t('settings.refreshButtonWarning'),
    autolock: '', // No warning needed for autolock
  };

  // Track changes to saved settings from Redux
  useEffect(() => {
    setSavedProperties({ ...advancedSettings });
    // Acknowledging one setting must not discard another unsaved change.
    if (
      !draftEdited.current ||
      (!submitting.current &&
        ADVANCED_SETTINGS.every(
          (prop) => enabledProperties[prop] === advancedSettings[prop]
        ))
    ) {
      draftEdited.current = false;
      setEnabledProperties({ ...advancedSettings });
    }
  }, [advancedSettings]);

  // Check if there are unsaved changes
  const hasUnsavedChanges = ADVANCED_SETTINGS.some(
    (prop) => enabledProperties[prop] !== savedProperties[prop]
  );
  const autolock = enabledProperties.autolock;
  const isAutolockValid =
    typeof autolock === 'number' &&
    Number.isInteger(autolock) &&
    (autolock === 0 || (autolock >= 5 && autolock <= 120));

  const updateDraft = (
    property: string,
    value: boolean | number | undefined
  ) => {
    const next = { ...enabledProperties, [property]: value };
    // Protect outstanding edits, not input activity that has been fully undone.
    draftEdited.current = ADVANCED_SETTINGS.some(
      (prop) => next[prop] !== savedProperties[prop]
    );
    setEnabledProperties(next);
  };

  const handleSwitchChange = (checked: boolean, advancedProperty: string) => {
    // Only handle confirmation for boolean settings that have warnings
    if (settingsWarnings[advancedProperty]) {
      setCurrentAdvancedProperty(advancedProperty);
      setConfirmationMessage(settingsWarnings[advancedProperty]);

      if (checked) {
        // If enabling, confirm first (since enabling creates more requests)
        setIsOpenConfirmationModal(true);
      } else {
        // If disabling, update directly
        updateDraft(advancedProperty, checked);
      }
    } else {
      // For settings without warnings, update directly
      updateDraft(advancedProperty, checked);
    }
  };

  const handleConfirmEnable = () => {
    updateDraft(currentAdvancedProperty, true);
    setIsOpenConfirmationModal(false);
  };

  const onSubmit = async () => {
    if (!hasUnsavedChanges || !isAutolockValid || submitting.current) return;

    submitting.current = true;
    const id = ++submissionId.current;
    const scope = getWalletNavigationScope();
    const isCurrent = () => {
      const currentScope = getWalletNavigationScope();
      return (
        mounted.current &&
        id === submissionId.current &&
        currentScope.account === scope.account &&
        currentScope.network === scope.network
      );
    };
    setLoading(true);
    setSaveError(false);

    try {
      await controllerEmitter(
        ['wallet', 'saveAdvancedSettings'],
        [{ refresh: enabledProperties.refresh, autolock }, scope]
      );
      if (!isCurrent()) return;

      // Update saved state after successful save
      draftEdited.current = false;
      setSavedProperties({ ...enabledProperties });
      setConfirmed(true);
    } catch (error) {
      if (!isCurrent()) return;
      console.error('Failed to save advanced settings:', error);
      setSaveError(true);
    } finally {
      if (isCurrent()) {
        submitting.current = false;
        setLoading(false);
      }
    }
  };

  return (
    <>
      <p className="mb-8 text-center text-white text-sm">
        {t('settings.hereYouCanEnable')}
      </p>

      <SmartAccountInfrastructure />

      <DefaultModal
        show={confirmed}
        onClose={() => {
          setConfirmed(false);
          navigateBack(navigate, location);
        }}
        title={t('settings.advancedSettingsWasSet')}
        description={t('settings.yourWalletWasConfigured')}
      />

      <ConfirmationModal
        title={t('buttons.confirm')}
        description={confirmationMessage}
        show={isOpenConfirmationModal}
        onClose={() => setIsOpenConfirmationModal(false)}
        onClick={handleConfirmEnable}
      />

      <Form
        validateMessages={{ default: '' }}
        className="flex flex-col gap-6 items-center justify-center text-center w-full"
        name="autolock"
        id="autolock"
        onFinish={onSubmit}
        autoComplete="off"
      >
        {ADVANCED_SETTINGS.map((propName: string, index: number) => (
          <Form.Item
            id={`advanced-setting-${propName}`}
            name={propName}
            className="!mb-0 flex flex-col w-full text-center"
            rules={[
              {
                required: false,
                message: '',
              },
            ]}
            key={index}
          >
            <div className="align-center flex flex-row flex-wrap gap-2 justify-center w-full text-center items-center">
              <label className="text-sm" htmlFor={`advanced-${propName}`}>
                {settingsTitles[propName]}
              </label>

              {propName === 'autolock' ? (
                // Number input for autolock timer
                <>
                  <div className="flex items-center gap-3 ml-2">
                    <input
                      id={`advanced-${propName}`}
                      type="number"
                      disabled={loading}
                      aria-invalid={!isAutolockValid}
                      aria-describedby="advanced-autolock-hint"
                      value={
                        enabledProperties.autolock === undefined
                          ? ''
                          : (enabledProperties.autolock as number)
                      }
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === '') {
                          // Allow empty state
                          updateDraft('autolock', undefined);
                          return;
                        }
                        const numValue = Number(value);
                        if (!isNaN(numValue)) {
                          updateDraft('autolock', numValue);
                        }
                      }}
                      onBlur={(e) => {
                        // Respect empty field state
                        const value = e.target.value;
                        if (value === '') {
                          // Keep it undefined if user cleared the field
                          return;
                        }
                        // Only constrain if there's an actual value
                        const numValue = Number(value);
                        // Allow 0 to disable, or 5-120 minutes
                        let constrainedValue = numValue;
                        if (numValue !== 0) {
                          constrainedValue = Math.max(
                            5,
                            Math.min(120, Math.round(numValue))
                          );
                        }
                        updateDraft('autolock', constrainedValue);
                      }}
                      min={0}
                      max={120}
                      step={1}
                      className="text-center text-white outline-none"
                      style={{
                        width: '60px',
                        height: '32px',
                        padding: '6px 8px',
                        borderRadius: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.2)',
                        backgroundColor: '#162742',
                        fontSize: '14px',
                        fontWeight: '500',
                      }}
                    />
                    <span className="text-sm text-gray-400">
                      {t('settings.minutes')}
                    </span>
                  </div>
                  {/* Helper text for autolock */}
                  <div
                    id="advanced-autolock-hint"
                    role={!isAutolockValid ? 'alert' : undefined}
                    className="text-xs text-content-muted mt-1"
                  >
                    {enabledProperties.autolock === 0
                      ? t('settings.autolockDisabled')
                      : t('settings.autolockHint')}
                  </div>
                </>
              ) : (
                // Toggle switch for other settings
                <Switch
                  id={`advanced-${propName}`}
                  disabled={loading}
                  checked={enabledProperties[propName] as boolean}
                  onChange={(checked) => handleSwitchChange(checked, propName)}
                  className="relative inline-flex items-center w-9 h-5 border border-brand-royalblue rounded-full"
                  style={{ margin: '0 auto !important' }}
                >
                  <span
                    className={`${
                      (enabledProperties[propName] as boolean)
                        ? 'translate-x-6 bg-warning-success'
                        : 'translate-x-1'
                    } inline-block w-2 h-2 transform bg-warning-error rounded-full`}
                  />
                </Switch>
              )}
            </div>
          </Form.Item>
        ))}

        <PageActionFooter
          error={saveError ? t('settings.preferencesSaveFailed') : undefined}
        >
          <Button
            variant="neutral"
            className="text-sm text-brand-royalblue"
            type="submit"
            loading={loading}
            fullWidth
            disabled={!hasUnsavedChanges || !isAutolockValid || loading}
          >
            {t('buttons.save')}
          </Button>
        </PageActionFooter>
      </Form>
    </>
  );
};

export default Advanced;
