import { Switch } from '@headlessui/react';
import { Form } from 'antd';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import {
  Layout,
  DefaultModal,
  NeutralButton,
  ConfirmationModal,
} from 'components/index';
import { useController } from 'hooks/useController';
import { RootState } from 'state/store';

const Advanced = () => {
  const { timer, advancedSettings } = useSelector(
    (state: RootState) => state.vault
  );
  const { t } = useTranslation();
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [enabledProperties, setEnabledProperties] = useState<{
    [k: string]: boolean;
  }>(advancedSettings);
  const [loading, setLoading] = useState<boolean>(false);
  const [confirmationMessage, setConfirmationMessage] = useState<string>('');
  const [currentAdvancedProperty, setCurrentAdvancedProperty] =
    useState<string>('');
  const [isOpenConfirmationModal, setIsOpenConfirmationModal] =
    useState<boolean>(false);

  const { controllerEmitter } = useController();
  const navigate = useNavigate();

  const onSubmit = async () => {
    setLoading(true);

    for (const prop of Object.keys(enabledProperties)) {
      await controllerEmitter(
        ['wallet', 'setAdvancedSettings'],
        [prop, enabledProperties[prop]]
      );
    }

    setConfirmed(true);
    setLoading(false);
  };

  const WARNING_MESSAGES = {
    refresh: t('settings.refreshButtonWarning'),
    ledger: t('settings.ledgerBetaWarning'),
  };

  const SETTINGS_TITLES = {
    refresh: t('settings.enableRefresh'),
    ledger: t('settings.enableLedger'),
  };

  const ADVACED_SETTINGS = ['refresh', 'ledger'];

  const handleConfirmAdvancedProp = (propName: string, message: string) => {
    setCurrentAdvancedProperty(propName);
    setConfirmationMessage(message);

    if (!enabledProperties[propName]) {
      setIsOpenConfirmationModal(!isOpenConfirmationModal);
    } else {
      setEnabledProperties((prevState) => ({
        ...prevState,
        [propName]: !prevState[propName],
      }));
    }
  };

  const handleOnClickModal = () => {
    setEnabledProperties((prevState) => ({
      ...prevState,
      [currentAdvancedProperty]: !prevState[currentAdvancedProperty],
    }));
    setIsOpenConfirmationModal(!isOpenConfirmationModal);
  };
  return (
    <Layout title={t('settings.advancedTitle')} id="auto-lock-timer-title">
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
        onClose={() => setIsOpenConfirmationModal(!isOpenConfirmationModal)}
        onClick={() => handleOnClickModal()}
      />

      <Form
        validateMessages={{ default: '' }}
        className="flex flex-col gap-8 items-center justify-center text-center"
        name="autolock"
        id="autolock"
        onFinish={onSubmit}
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 16 }}
        initialValues={{ minutes: timer }}
        autoComplete="off"
      >
        {ADVACED_SETTINGS.map((propName: string, index: number) => (
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
            <div className="align-center flex flex-row gap-2 justify-center w-full text-center">
              <span className="text-sm">{SETTINGS_TITLES[propName]}</span>
              <Switch
                checked={enabledProperties[propName]}
                onChange={() =>
                  handleConfirmAdvancedProp(
                    propName,
                    WARNING_MESSAGES[propName]
                  )
                }
                className="relative inline-flex items-center w-9 h-5 border border-brand-royalblue rounded-full"
                style={{ margin: '0 auto !important' }}
              >
                <span
                  className={`${
                    enabledProperties[propName]
                      ? 'translate-x-6 bg-warning-success'
                      : 'translate-x-1'
                  } inline-block w-2 h-2 transform bg-warning-error rounded-full`}
                />
              </Switch>
            </div>
          </Form.Item>
        ))}

        <div className="absolute bottom-12 md:static">
          <NeutralButton type="submit" loading={loading}>
            {t('buttons.save')}
          </NeutralButton>
        </div>
      </Form>
    </Layout>
  );
};

export default Advanced;
