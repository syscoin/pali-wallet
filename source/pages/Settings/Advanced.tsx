import { Switch } from '@headlessui/react';
import { Form } from 'antd';
import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import {
  Layout,
  DefaultModal,
  NeutralButton,
  ConfirmationModal,
} from 'components/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

const WARNING_MESSAGES = {
  refresh:
    'The refresh button dispatches multiple requests to the blockchain through an RPC, if you activating this be sure to add in your own paid RPC providers to avoid reaching the public RPCs rate-limit. Use it at your own accountability',
};

const Advanced = () => {
  const { timer, advancedSettings } = useSelector(
    (state: RootState) => state.vault
  );

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

  const controller = getController();
  const navigate = useNavigate();

  const onSubmit = () => {
    setLoading(true);

    for (const prop of Object.keys(enabledProperties)) {
      controller.wallet.setAdvancedSettings(prop, enabledProperties[prop]);
    }

    setConfirmed(true);
    setLoading(false);
  };

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
    <Layout title="ADVANCED SETTINGS" id="auto-lock-timer-title">
      <p className="mb-8 text-center text-white text-sm">
        Here, you can enable advanced settings in Pali. Use them responsibly and
        at your own risk.
      </p>

      <DefaultModal
        show={confirmed}
        onClose={() => {
          setConfirmed(false);
          navigate('/home');
        }}
        title="Advanced settings was set successfully"
        description="Your wallet was configured successfully. You can change it at any time."
      />

      <ConfirmationModal
        title="Warning"
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
            <span className="text-sm">Enable wallet refresh button</span>
            <Switch
              checked={enabledProperties['refresh']}
              onChange={() =>
                handleConfirmAdvancedProp(
                  'refresh',
                  WARNING_MESSAGES['refresh']
                )
              }
              className="relative inline-flex items-center w-9 h-5 border border-brand-royalblue rounded-full"
              style={{ margin: '0 auto !important' }}
            >
              <span
                className={`${
                  enabledProperties['refresh']
                    ? 'translate-x-6 bg-warning-success'
                    : 'translate-x-1'
                } inline-block w-2 h-2 transform bg-warning-error rounded-full`}
              />
            </Switch>
          </div>
        </Form.Item>

        <div className="absolute bottom-12 md:static">
          <NeutralButton type="submit" loading={loading}>
            Save
          </NeutralButton>
        </div>
      </Form>
    </Layout>
  );
};

export default Advanced;
