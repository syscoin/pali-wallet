import { Switch } from '@headlessui/react';
import { Form } from 'antd';
import React, { useEffect } from 'react';
import { useState, FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

import { CustomJsonRpcProvider } from '@pollum-io/sysweb3-keyring';
import { validateEthRpc } from '@pollum-io/sysweb3-network';

import { Layout } from 'components/index';
import { getController } from 'scripts/Background';
import { RootState } from 'state/store';

import { CustomToken } from './CustomToken';
import { ImportToken } from './ImportToken';
import { SyscoinImportToken } from './SyscoinImport';

export const AddToken: FC = () => {
  const [form] = Form.useForm();

  const { state } = useLocation();

  const [importCustom, setImportCustom] = useState(false);
  const [isTestnet, setIsTestnet] = useState(false);

  const controller = getController();
  const { isInCooldown }: CustomJsonRpcProvider =
    controller.wallet.ethereumTransaction.web3Provider;
  const { isBitcoinBased, activeNetwork: network } = useSelector(
    (paliState: RootState) => paliState.vault
  );
  const { t } = useTranslation();

  const verifyIfIsTestnet = async () => {
    const { chain, chainId } = await validateEthRpc(network.url, isInCooldown);

    const ethTestnetsChainsIds = [5700, 80001, 11155111, 421611, 5, 69]; // Some ChainIds from Ethereum Testnets as Polygon Testnet, Goerli, Sepolia, etc.

    return Boolean(
      chain === 'test' ||
        chain === 'testnet' ||
        ethTestnetsChainsIds.some(
          (validationChain) => validationChain === chainId
        )
    );
  };

  useEffect(() => {
    verifyIfIsTestnet().then((_isTestnet) => setIsTestnet(_isTestnet));
  }, [network, network.chainId]);

  const searchTokenValidation = Boolean(network.chainId === 1); // Only allow to Ethereum Mainnet chain ID

  const isEditToken = Boolean(state && state.contractAddress);

  const validatedTitle = isEditToken
    ? t('tokens.editToken')
    : t('tokens.importToken');

  return (
    <Layout title={validatedTitle}>
      {isBitcoinBased ? (
        <SyscoinImportToken />
      ) : (
        <>
          {!isTestnet && searchTokenValidation ? (
            <>
              <Form
                form={form}
                validateMessages={{ default: '' }}
                id="token"
                name="token"
                labelCol={{ span: 8 }}
                wrapperCol={{ span: 8 }}
                autoComplete="off"
                className="flex flex-col gap-2 items-center justify-center text-center"
              >
                <Form.Item
                  id="network-switch"
                  name="network-switch"
                  rules={[
                    {
                      required: false,
                      message: '',
                    },
                  ]}
                >
                  <div className="flex gap-x-2 my-4 text-xs">
                    <p className="text-brand-royalblue">{t('tokens.search')}</p>

                    <Switch
                      checked={importCustom}
                      onChange={() => setImportCustom(!importCustom)}
                      className="relative inline-flex items-center w-9 h-4 border border-brand-royalblue rounded-full"
                    >
                      <span className="sr-only">
                        {t('tokens.searchOrCustomToken')}
                      </span>
                      <span
                        className={`${
                          importCustom
                            ? 'translate-x-6 bg-brand-royalblue'
                            : 'translate-x-1 bg-brand-deepPink100'
                        } inline-block w-2 h-2 transform rounded-full`}
                      />
                    </Switch>

                    <p className="text-brand-deepPink100">
                      {t('token.customToke')}
                    </p>
                  </div>
                </Form.Item>
              </Form>
              {importCustom ? (
                <CustomToken isEdit={isEditToken} tokenToEdit={null} />
              ) : (
                <ImportToken />
              )}
            </>
          ) : (
            <CustomToken isEdit={isEditToken} tokenToEdit={state} />
          )}
        </>
      )}
    </Layout>
  );
};
