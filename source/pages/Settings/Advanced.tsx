import { Switch } from '@headlessui/react';
import { Form } from 'antd';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import {
  DefaultModal,
  NeutralButton,
  ConfirmationModal,
} from 'components/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';

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
  const [loading, setLoading] = useState<boolean>(false);
  const [confirmationMessage, setConfirmationMessage] = useState<string>('');
  const [currentAdvancedProperty, setCurrentAdvancedProperty] =
    useState<string>('');
  const [isOpenConfirmationModal, setIsOpenConfirmationModal] =
    useState<boolean>(false);

  const { controllerEmitter } = useController();
  const navigate = useNavigate();

  const ADVANCED_SETTINGS = ['refresh', 'autolock'];

  const settingsTitles = {
    refresh: t('settings.enableRefresh'),
    autolock: t('settings.enableAutolock'),
  };

  const settingsWarnings = {
    refresh: t('settings.refreshButtonWarning'),
    autolock: '', // No warning needed for autolock
  };

  const handleSwitchChange = (checked: boolean, advancedProperty: string) => {
    // Only handle confirmation for boolean settings that have warnings
    if (settingsWarnings[advancedProperty]) {
      setCurrentAdvancedProperty(advancedProperty);
      setConfirmationMessage(settingsWarnings[advancedProperty]);

      if (!checked) {
        // If disabling, confirm first
        setIsOpenConfirmationModal(true);
      } else {
        // If enabling, update directly
        setEnabledProperties((prevState) => ({
          ...prevState,
          [advancedProperty]: checked,
        }));
      }
    } else {
      // For settings without warnings, update directly
      setEnabledProperties((prevState) => ({
        ...prevState,
        [advancedProperty]: checked,
      }));
    }
  };

  const handleConfirmDisable = () => {
    setEnabledProperties((prevState) => ({
      ...prevState,
      [currentAdvancedProperty]: false,
    }));
    setIsOpenConfirmationModal(false);
  };

  const onSubmit = async () => {
    setLoading(true);

    try {
      // Save all advanced settings together
      for (const property of ADVANCED_SETTINGS) {
        await controllerEmitter(
          ['wallet', 'setAdvancedSettings'],
          [property, enabledProperties[property]]
        );
      }

      setConfirmed(true);
    } catch (error) {
      console.error('Failed to save advanced settings:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <p className="mb-8 text-center text-white text-sm">
        {t('settings.hereYouCanEnable')}
      </p>

      <DefaultModal
        show={confirmed}
        onClose={() => {
          setConfirmed(false);
          navigate('/home');
        }}
        title={t('settings.advancedSettingsWasSet')}
        description={t('settings.yourWalletWasConfigured')}
      />

      <ConfirmationModal
        title={t('settings.forgetWarning')}
        description={confirmationMessage}
        show={isOpenConfirmationModal}
        onClose={() => setIsOpenConfirmationModal(false)}
        onClick={handleConfirmDisable}
      />

      <Form
        validateMessages={{ default: '' }}
        className="flex flex-col gap-8 items-center justify-center text-center"
        name="autolock"
        id="autolock"
        onFinish={onSubmit}
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 16 }}
        autoComplete="off"
      >
        {ADVANCED_SETTINGS.map((propName: string, index: number) => (
          <Form.Item
            id="verify-address-switch"
            name={propName}
            className="flex flex-col w-full text-center"
            rules={[
              {
                required: false,
                message: '',
              },
            ]}
            key={index}
          >
            <div className="align-center flex flex-row gap-2 justify-center w-full text-center items-center">
              <span className="text-sm">{settingsTitles[propName]}</span>

              {propName === 'autolock' ? (
                // Number input for autolock timer
                <div className="flex items-center gap-3 ml-2">
                  <input
                    type="number"
                    value={
                      enabledProperties.autolock === undefined
                        ? ''
                        : (enabledProperties.autolock as number)
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '') {
                        // Allow empty state
                        setEnabledProperties((prevState) => ({
                          ...prevState,
                          autolock: undefined,
                        }));
                        return;
                      }
                      const numValue = Number(value);
                      if (!isNaN(numValue)) {
                        setEnabledProperties((prevState) => ({
                          ...prevState,
                          autolock: numValue,
                        }));
                      }
                    }}
                    onBlur={(e) => {
                      // Just ensure it's in valid range
                      const value = Number(e.target.value) || 5;
                      const constrainedValue = Math.max(
                        5,
                        Math.min(120, value)
                      );
                      setEnabledProperties((prevState) => ({
                        ...prevState,
                        autolock: constrainedValue,
                      }));
                    }}
                    min={5}
                    max={120}
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
              ) : (
                // Toggle switch for other settings
                <Switch
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

        <div className="absolute bottom-12 md:static">
          <NeutralButton type="submit" loading={loading}>
            {t('buttons.save')}
          </NeutralButton>
        </div>
      </Form>
    </>
  );
};

export default Advanced;
