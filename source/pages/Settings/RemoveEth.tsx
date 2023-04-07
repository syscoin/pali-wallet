import { Switch } from '@headlessui/react';
import { Form } from 'antd';
import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { Layout, DefaultModal, NeutralButton } from 'components/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

const RemoveEthView = () => {
  const { timer, hasEthProperty } = useSelector(
    (state: RootState) => state.vault
  );

  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [isEnabled, setIsEnabled] = useState<boolean>(hasEthProperty);
  const [loading, setLoading] = useState<boolean>(false);

  const controller = getController();
  const navigate = useNavigate();

  const onSubmit = () => {
    setLoading(true);

    switch (isEnabled) {
      case true:
        controller.wallet.addWindowEthProperty();
        controller.wallet.setHasEthProperty(true);
        setConfirmed(true);
        setLoading(false);
        break;
      case false:
        controller.wallet.removeWindowEthProperty();
        controller.wallet.setHasEthProperty(false);
        const dapps = Object.values(controller.dapp.getAll());
        // disconnect from all dapps when remove window.ethereum property
        if (dapps.length) {
          for (const dapp of dapps) {
            controller.dapp.disconnect(dapp.host);
          }
        }
        setConfirmed(true);
        setLoading(false);
        break;
      default:
        break;
    }
  };

  return (
    <Layout title="MANAGE ETH PROVIDER" id="auto-lock-timer-title">
      <p className="mb-8 text-center text-white text-sm">
        For use another ETH wallet, you can disable window.ethereum injected by
        Pali.
      </p>

      <DefaultModal
        show={confirmed}
        onClose={() => {
          setConfirmed(false);
          navigate('/home');
        }}
        title="Window object set successfully"
        description="Your wallet was configured successfully. You can change it at any time."
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
            <span className="text-sm">Enable window.ethereum</span>
            <Switch
              checked={isEnabled}
              onChange={() => setIsEnabled(!isEnabled)}
              className="relative inline-flex items-center w-9 h-5 border border-brand-royalblue rounded-full"
              style={{ margin: '0 auto !important' }}
            >
              <span
                className={`${
                  isEnabled
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

export default RemoveEthView;
