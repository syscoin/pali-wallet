import { Form, Input } from 'antd';
import * as React from 'react';
import { useState } from 'react';
import { useSelector } from 'react-redux';

import { getAsset } from '@pollum-io/sysweb3-utils';

import { DefaultModal, ErrorModal, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

export const SyscoinImportToken = () => {
  const controller = getController();

  const [form] = Form.useForm();
  const { navigate } = useUtils();

  const [added, setAdded] = useState(false);
  const [error, setError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const nextStep = async ({ assetGuid }: { assetGuid: string }) => {
    try {
      setIsLoading(true);

      const metadata = await getAsset(activeNetwork.url, assetGuid);

      if (metadata && metadata.symbol) {
        await controller.wallet.account.sys.saveTokenInfo({
          ...metadata,
          symbol: metadata.symbol ? atob(String(metadata.symbol)) : '',
        });

        setAdded(true);
        setIsLoading(false);

        return;
      }
    } catch (_error) {
      setError(Boolean(_error));
      setIsLoading(false);
    }
  };

  return (
    <>
      <Form
        validateMessages={{ default: '' }}
        form={form}
        id="token-form"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        onFinish={nextStep}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center mt-4 text-center md:w-full"
      >
        <Form.Item
          name="assetGuid"
          className="md:w-full md:max-w-md"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
            },
            () => ({
              async validator(_, value) {
                const data = await getAsset(activeNetwork.url, value);

                if (!value || data) {
                  if (data && data.symbol) {
                    form.setFieldValue('symbol', atob(String(data.symbol)));
                  }

                  return Promise.resolve();
                }

                return Promise.reject();
              },
            }),
          ]}
        >
          <Input
            type="text"
            className="input-small relative"
            placeholder="Token Guid"
          />
        </Form.Item>

        <Form.Item
          name="symbol"
          className="md:w-full md:max-w-md"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
            },
          ]}
        >
          <Input
            type="text"
            className="input-small relative"
            placeholder="Token symbol"
          />
        </Form.Item>

        <div className="flex flex-col items-center justify-center w-full">
          <div className="absolute bottom-12 md:static">
            <NeutralButton loading={isLoading} type="submit">
              Next
            </NeutralButton>
          </div>
        </div>
      </Form>

      {added && (
        <DefaultModal
          show={added}
          title="Token successfully added"
          description={`${form.getFieldValue(
            'symbol'
          )} was successfully added to your wallet.`}
          onClose={() => navigate('/home')}
        />
      )}

      {error && (
        <ErrorModal
          show={Boolean(error)}
          title="Could not add token"
          description="Could not add token to your wallet. Check the network and the asset guid and try again later."
          log="Token not found in your XPUB or token is already imported."
          onClose={() => setError(false)}
        />
      )}
    </>
  );
};
