import { Switch } from '@headlessui/react';
import { Form } from 'antd';
import React, { useCallback, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';

import {
  Button,
  Card,
  ConfirmationModal,
  DefaultModal,
} from 'components/index';
import { useUtils } from 'hooks/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';
import { navigateBack } from 'utils/navigationState';

type InfrastructureStatus = {
  contracts: Array<{
    deployed: boolean;
    displayName: string;
    id: string;
  }>;
  create2Deployer: {
    deployed: boolean;
  };
  ready: boolean;
};

const getInfrastructureDeployErrorMessage = (error: any, t: any) => {
  const message = String(error?.message || error || '');
  const normalized = message.toLowerCase();

  if (
    normalized.includes('lackoffund') ||
    normalized.includes('lack of fund') ||
    normalized.includes('insufficient funds') ||
    normalized.includes('insufficient balance') ||
    (normalized.includes('maxfee') && normalized.includes('fund'))
  ) {
    return t('settings.smartAccountInfrastructureInsufficientGas');
  }

  if (message.length > 180 || normalized.includes('0x')) {
    return t('settings.smartAccountInfrastructureDeployFailed');
  }

  return message || t('settings.smartAccountInfrastructureDeployFailed');
};

const Advanced = () => {
  const { advancedSettings } = useSelector(
    (state: RootState) => state.vaultGlobal
  );
  const { activeNetwork, isBitcoinBased } = useSelector(
    (state: RootState) => state.vault
  );
  const { t } = useTranslation();
  const { alert } = useUtils();
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
  const [confirmationMessage, setConfirmationMessage] = useState<string>('');
  const [currentAdvancedProperty, setCurrentAdvancedProperty] =
    useState<string>('');
  const [isOpenConfirmationModal, setIsOpenConfirmationModal] =
    useState<boolean>(false);
  const [infrastructureStatus, setInfrastructureStatus] =
    useState<InfrastructureStatus | null>(null);
  const [loadingInfrastructure, setLoadingInfrastructure] = useState(false);

  const { controllerEmitter } = useController();
  const navigate = useNavigate();
  const location = useLocation();

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
    setEnabledProperties({ ...advancedSettings });
  }, [advancedSettings]);

  const loadInfrastructureStatus = useCallback(async () => {
    if (isBitcoinBased) {
      setInfrastructureStatus(null);
      return;
    }
    try {
      const status = (await controllerEmitter([
        'wallet',
        'getSmartAccountInfrastructureStatus',
      ])) as InfrastructureStatus;
      setInfrastructureStatus(status);
    } catch {
      setInfrastructureStatus(null);
    }
  }, [controllerEmitter, isBitcoinBased]);

  useEffect(() => {
    loadInfrastructureStatus();
  }, [activeNetwork.chainId, loadInfrastructureStatus]);

  // Check if there are unsaved changes
  const hasUnsavedChanges = ADVANCED_SETTINGS.some(
    (prop) => enabledProperties[prop] !== savedProperties[prop]
  );

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

  const handleConfirmEnable = () => {
    setEnabledProperties((prevState) => ({
      ...prevState,
      [currentAdvancedProperty]: true,
    }));
    setIsOpenConfirmationModal(false);
  };

  const onSubmit = async () => {
    if (!hasUnsavedChanges) return;

    setLoading(true);

    try {
      // Save all advanced settings together
      for (const property of ADVANCED_SETTINGS) {
        await controllerEmitter(
          ['wallet', 'setAdvancedSettings'],
          [property, enabledProperties[property]]
        );
      }

      // Update saved state after successful save
      setSavedProperties({ ...enabledProperties });
      setConfirmed(true);
    } catch (error) {
      console.error('Failed to save advanced settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const deployInfrastructure = async () => {
    setLoadingInfrastructure(true);
    try {
      await controllerEmitter(
        ['wallet', 'deploySmartAccountInfrastructure'],
        [],
        300000
      );
      await loadInfrastructureStatus();
      alert.success(t('settings.smartAccountInfrastructureSubmitted'));
    } catch (error: any) {
      alert.error(getInfrastructureDeployErrorMessage(error, t));
    } finally {
      try {
        await loadInfrastructureStatus();
      } finally {
        setLoadingInfrastructure(false);
      }
    }
  };

  const missingInfrastructure =
    infrastructureStatus?.contracts.filter((contract) => !contract.deployed) ||
    [];

  return (
    <>
      <p className="mb-8 text-center text-white text-sm">
        {t('settings.hereYouCanEnable')}
      </p>

      {!isBitcoinBased && (
        <div className="mx-auto mb-5 flex w-full max-w-[352px] text-left">
          <Card type={infrastructureStatus?.ready ? 'success' : 'info'}>
            <div className="flex w-full flex-col gap-2 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-brand-white">
                    {t('settings.smartAccountInfrastructure')}
                  </p>
                  <p className="mt-1 text-xs leading-4 text-brand-graylight">
                    {infrastructureStatus?.ready
                      ? t('settings.smartAccountInfrastructureReady')
                      : t('settings.smartAccountInfrastructureMissingAdvanced')}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-alpha-whiteAlpha100 px-2 py-1 text-[10px] font-medium text-brand-graylight">
                  {t(
                    infrastructureStatus?.ready
                      ? 'settings.smartAccountInfrastructureReadyStatus'
                      : 'settings.smartAccountInfrastructureNotReadyStatus'
                  )}
                </span>
              </div>
              {!infrastructureStatus?.create2Deployer.deployed && (
                <p className="text-xs leading-4 text-brand-graylight">
                  {t('settings.smartAccountCreate2Missing')}
                </p>
              )}
              {missingInfrastructure.length > 0 && (
                <p className="text-xs leading-4 text-brand-graylight">
                  {t('settings.smartAccountInfrastructureMissingCount', {
                    count: missingInfrastructure.length,
                  })}
                </p>
              )}
              {infrastructureStatus?.create2Deployer.deployed &&
                missingInfrastructure.length > 0 && (
                  <Button
                    variant="neutral"
                    className="text-sm text-brand-royalblue"
                    type="button"
                    loading={loadingInfrastructure}
                    disabled={loadingInfrastructure}
                    onClick={deployInfrastructure}
                  >
                    {t('settings.deploySmartAccountInfrastructure')}
                  </Button>
                )}
            </div>
          </Card>
        </div>
      )}

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
        className="flex flex-col gap-8 items-center justify-center text-center w-full"
        name="autolock"
        id="autolock"
        onFinish={onSubmit}
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
                <>
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
                            Math.min(120, numValue)
                          );
                        }
                        setEnabledProperties((prevState) => ({
                          ...prevState,
                          autolock: constrainedValue,
                        }));
                      }}
                      min={0}
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
                  {/* Helper text for autolock */}
                  <div className="text-xs text-gray-500 mt-1">
                    {enabledProperties.autolock === 0
                      ? t('settings.autolockDisabled')
                      : t('settings.autolockHint')}
                  </div>
                </>
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

        <div className="w-full px-4 absolute bottom-12 md:static">
          <Button
            variant="neutral"
            className="text-sm text-brand-royalblue"
            type="submit"
            loading={loading}
            fullWidth
            disabled={!hasUnsavedChanges}
          >
            {t('buttons.save')}
          </Button>
        </div>
      </Form>
    </>
  );
};

export default Advanced;
