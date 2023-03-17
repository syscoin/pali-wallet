import { Form, Input } from 'antd';
import { ethers } from 'ethers';
import * as React from 'react';
import { useState } from 'react';
import { useSelector } from 'react-redux';

import { isValidEthereumAddress } from '@pollum-io/sysweb3-utils';

import { DefaultModal, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';

import { CustomTokenErrorModal } from './CustomTokenErrorModal';

export const CustomToken = () => {
  const controller = getController();

  const [form] = Form.useForm();
  const { navigate } = useUtils();

  const [added, setAdded] = useState(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [ercError, setErcError] = useState({
    errorType: '',
    message: '',
  });

  const { accounts, activeAccount: activeAccountId } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountId];

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );

  const handleSubmit = async ({
    contractAddress,
    symbol,
    decimals,
  }: {
    contractAddress: string;
    decimals: number;
    symbol: string;
  }) => {
    setIsLoading(true);

    try {
      const provider = new ethers.providers.JsonRpcProvider(activeNetwork.url);

      const addTokenMethodResponse =
        await controller.wallet.assets.evm.addCustomTokenByType(
          activeAccount.address,
          contractAddress,
          symbol,
          decimals,
          provider
        );

      if (addTokenMethodResponse.error) {
        setIsLoading(false);
        setErcError({
          errorType: addTokenMethodResponse.errorType,
          message: addTokenMethodResponse.message,
        });

        return;
      }

      await controller.wallet.account.eth.saveTokenInfo(
        addTokenMethodResponse.tokenToAdd
      );

      setAdded(true);
    } catch (error) {
      setErcError({
        errorType: 'Undefined',
        message: '',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const resetErcErrorState = () => {
    setErcError({
      errorType: '',
      message: '',
    });
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
            <NeutralButton
              type="submit"
              disabled={isLoading}
              loading={isLoading}
            >
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

      {ercError.errorType !== '' ? (
        <CustomTokenErrorModal
          errorType={ercError.errorType}
          message={ercError.message}
          resetErcErrorState={resetErcErrorState}
        />
      ) : null}
    </>
  );
};
