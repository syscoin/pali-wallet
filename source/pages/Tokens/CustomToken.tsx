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
  contractChecker,
  ISupportsInterfaceProps,
} from '@pollum-io/sysweb3-utils';

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
  const [ercError, setErcError] = useState({
    errorType: '',
    message: '',
  });

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
        isNft: false,
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
    setActiveNetwork(activeNetwork);

    const contractResponse = (await contractChecker(
      contractAddress,
      activeNetwork.url
    )) as ISupportsInterfaceProps;

    if (String(contractResponse).includes('Invalid contract address')) {
      setErcError({
        errorType: 'Invalid',
        message:
          'Invalid contract address. Verify the current contract address or the current network!',
      });

      return;
    }

    switch (contractResponse.type) {
      case 'ERC-721':
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
            isNft: true,
            balance: balanceToNumber,
          });

          setAdded(true);

          return;
        } catch (_erc721Error) {
          setErcError({
            errorType: 'Undefined',
            message: '',
          });
        }
        break;
      case 'ERC-1155':
        setErcError({
          errorType: 'ERC-1155',
          message: contractResponse.message,
        });
        break;
      default:
        // Default will be for cases when contract type will come as Undefined. This type is for ERC-20 cases or contracts that type
        // has not been founded
        try {
          return await handleERC20Tokens(contractAddress, decimals);
        } catch (_ercUndefinedError) {
          setErcError({
            errorType: 'Undefined',
            message: '',
          });
        }
        break;
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
