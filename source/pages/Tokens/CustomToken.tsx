import { Form, Input } from 'antd';
import * as React from 'react';
import { useState } from 'react';

import {
  getSearch,
  isValidEthereumAddress,
  validateToken,
} from '@pollum-io/sysweb3-utils';

import {
  SecondaryButton,
  DefaultModal,
  Layout,
  ErrorModal,
} from 'components/index';
import { useUtils } from 'hooks/index';
import { getController } from 'utils/browser';

export const CustomToken = () => {
  const controller = getController();

  const [form] = Form.useForm();
  const { navigate } = useUtils();

  const [added, setAdded] = useState(false);
  const [error, setError] = useState(false);

  const nextStep = async ({
    contract,
    symbol,
    decimal,
  }: {
    contract: string;
    decimal: number;
    symbol: string;
  }) => {
    const tokenIsValid = await validateToken(contract);

    if (tokenIsValid) {
      const { coins } = await getSearch(tokenIsValid.symbol);

      const { id, marketCapRank, name, thumb } = coins[0];

      await controller.wallet.account.eth.saveTokenInfo({
        symbol: symbol.toUpperCase(),
        contract,
        decimal,
        marketCapRank,
        id,
        explorer: '',
        description: '',
        image: thumb,
        links: '',
        name,
      });

      setAdded(true);

      return;
    }

    setError(true);
  };

  return (
    <Layout title="CUSTOM TOKEN">
      <Form
        validateMessages={{ default: '' }}
        form={form}
        id="send-form"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        onFinish={nextStep}
        autoComplete="off"
        className="standard flex flex-col gap-3 items-center justify-center mt-4 text-center md:w-full"
      >
        <Form.Item
          name="contract"
          className="md:w-full md:max-w-md"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
            },
            () => ({
              validator(_, value) {
                if (!value || isValidEthereumAddress(value)) {
                  return Promise.resolve();
                }

                return Promise.reject();
              },
            }),
          ]}
        >
          <Input
            type="text"
            placeholder="Contract address"
            className="pl-4 pr-8 py-3 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full outline-none md:w-full"
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
            placeholder="Token symbol"
            className="pl-4 pr-8 py-3 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full outline-none md:w-full"
          />
        </Form.Item>

        <Form.Item
          name="decimal"
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
            type="number"
            placeholder="Token decimal"
            className="pl-4 pr-8 py-3 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full outline-none md:w-full"
          />
        </Form.Item>

        <div className="flex flex-col items-center justify-center w-full">
          <div className="absolute bottom-12 md:static">
            <SecondaryButton type="submit">Next</SecondaryButton>
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
          show={error}
          title="Verify the current token"
          description="This token probably is not available in the current network. Verify the token network and try again."
          log="Token network probably is different from current network."
          onClose={() => setError(false)}
        />
      )}
    </Layout>
  );
};
