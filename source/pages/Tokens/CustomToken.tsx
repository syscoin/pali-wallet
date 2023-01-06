import { Form, Input } from 'antd';
import loadsh from 'lodash';
import * as React from 'react';
import { useState } from 'react';
import { useSelector } from 'react-redux';

import { setActiveNetwork, web3Provider } from '@pollum-io/sysweb3-network';
import {
  getTokenStandardMetadata,
  isValidEthereumAddress,
  getERC721StandardBalance,
} from '@pollum-io/sysweb3-utils';

import { DefaultModal, ErrorModal, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

export const CustomToken = () => {
  const controller = getController();

  const [form] = Form.useForm();
  const { navigate } = useUtils();

  const [added, setAdded] = useState(false);
  const [error, setError] = useState(false);

  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const handleERC721NFTs = async (contractAddress: string) => {
    const getBalance = await getERC721StandardBalance(
      contractAddress,
      activeAccount.address,
      web3Provider
    );

    const balanceToNumber = Number(getBalance);

    return {
      defaultFetchValue: getBalance,
      balanceToNumber,
    };
  };

  const handleERC20Tokens = async (
    contractAddress: string,
    decimals: number
  ) => {
    const metadata = await getTokenStandardMetadata(
      contractAddress,
      activeAccount.address,
      web3Provider
    );

    const balance = `${metadata.balance / 10 ** metadata.decimals}`;
    const formattedBalance = loadsh.floor(parseFloat(balance), 4);

    if (metadata) {
      form.setFieldValue('symbol', metadata.tokenSymbol.toUpperCase());

      await controller.wallet.account.eth.saveTokenInfo({
        tokenSymbol: metadata.tokenSymbol.toUpperCase(),
        contractAddress,
        decimals,
        balance: formattedBalance,
      });

      setAdded(true);

      return;
    }
  };

  const handleSubmit = async ({
    contractAddress,
    symbol,
    decimals,
  }: {
    contractAddress: string;
    decimals: number;
    symbol: string;
  }) => {
    const setDecimalsInNumber = Number(decimals);

    setActiveNetwork(activeNetwork);
    switch (setDecimalsInNumber) {
      case 0:
        try {
          const { defaultFetchValue, balanceToNumber } = await handleERC721NFTs(
            contractAddress
          );

          if (
            typeof balanceToNumber !== 'number' ||
            Number.isNaN(balanceToNumber) ||
            Boolean(String(defaultFetchValue).includes('Error'))
          ) {
            await handleERC20Tokens(contractAddress, decimals);

            return;
          }

          const treatedSymbol = symbol.replaceAll(/\s/g, '').toUpperCase();

          await controller.wallet.account.eth.saveTokenInfo({
            tokenSymbol: treatedSymbol,
            contractAddress,
            decimals,
            balance: balanceToNumber,
          });

          setAdded(true);

          return;
        } catch (_error) {
          setError(Boolean(_error));
        }
        break;
      default:
        try {
          return await handleERC20Tokens(contractAddress, decimals);
        } catch (_error) {
          setError(Boolean(_error));
        }
        break;
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
        onFinish={handleSubmit}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center mt-4 text-center md:w-full"
      >
        <Form.Item
          name="contractAddress"
          className="md:w-full md:max-w-md"
          hasFeedback
          rules={[
            {
              required: true,
              message: 'Please, type token contract address!',
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
            className="input-small relative"
            placeholder="Contract address"
          />
        </Form.Item>

        <Form.Item
          name="symbol"
          className="md:w-full md:max-w-md"
          hasFeedback
          rules={[
            {
              required: true,
              message: 'Please, type token symbol!',
            },
          ]}
        >
          <Input
            type="text"
            className="input-small relative"
            placeholder="Token symbol"
          />
        </Form.Item>

        <Form.Item
          name="decimals"
          className="md:w-full md:max-w-md"
          hasFeedback
          rules={[
            {
              required: true,
              message: 'Please, type token decimals!',
            },
          ]}
        >
          <Input
            type="number"
            className="input-small relative"
            placeholder="Token decimal"
          />
        </Form.Item>

        <div className="flex flex-col items-center justify-center w-full">
          <div className="absolute bottom-12 md:static">
            <NeutralButton type="submit">Next</NeutralButton>
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
          title="Verify the current network"
          description="This token probably is not available in the current network. Verify the token network and try again."
          log="Token network probably is different from current network."
          onClose={() => setError(false)}
        />
      )}
    </>
  );
};
