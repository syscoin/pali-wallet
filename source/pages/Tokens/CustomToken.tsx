import * as React from 'react';
import { useState, FC } from 'react';
import { useUtils } from 'hooks/index';
import { Form, Input } from 'antd';
import {
  SecondaryButton,
  DefaultModal,
  Layout,
  ErrorModal,
} from 'components/index';
import { getController } from 'utils/browser';
import {
  getWeb3TokenData,
  isValidEthereumAddress,
  validateToken,
  getSearch,
} from '@pollum-io/sysweb3-utils';
import { setActiveNetwork } from '@pollum-io/sysweb3-network';

import { useStore } from '../../hooks/useStore';

export const CustomToken: FC = () => {
  const controller = getController();
  const { activeNetwork } = useStore();

  const [form] = Form.useForm();
  const { navigate } = useUtils();

  const [added, setAdded] = useState(false);
  const [error, setError] = useState(false);

  const isEthereumMainnet = activeNetwork.chainId === 1;
  const nextStep = async ({
    contract,
    symbol,
    decimal,
  }: {
    contract: string;
    decimal: number;
    symbol: string;
  }) => {
    if (isEthereumMainnet) {
      const {
        asset_platform_id,
        id,
        current_price,
        description,
        explorer,
        image,
        links,
        name,
      } = await getWeb3TokenData(`${contract}`);

      await controller.wallet.account.sys.saveTokenInfo({
        symbol: symbol.toUpperCase(),
        contract_address: contract,
        decimal,
        asset_platform_id,
        id,
        current_price,
        description,
        explorer,
        image,
        links,
        name,
      });

      setAdded(true);
    }
    setActiveNetwork(activeNetwork);

    const tokenSymbol = await validateToken(contract).then((r) => r);
    if (tokenSymbol) {
      const {
        data: { coins },
      } = await getSearch(tokenSymbol.symbol);

      const { id, market_cap_rank, name, thumb } = coins[0];

      await controller.wallet.account.sys.saveTokenInfo({
        symbol: symbol.toUpperCase(),
        contract_address: contract,
        decimal,
        market_cap_rank,
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
        form={form}
        id="send-form"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        onFinish={nextStep}
        autoComplete="off"
        className="form flex flex-col gap-10 items-center justify-center mt-4 text-center md:w-full"
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
          description={`${form
            .getFieldValue('symbol')
            .toUpperCase()} was successfully added to your wallet.`}
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
