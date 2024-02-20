import { Form, Input } from 'antd';
import { isBoolean, isNil, uniqueId } from 'lodash';
import React from 'react';
import { useState, FC } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { getTokenJson } from '@pollum-io/sysweb3-utils';

import { DefaultModal, ErrorModal, NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { ITokenEthProps } from 'types/tokens';
import { getController } from 'utils/browser';

export const ImportToken: FC = () => {
  const controller = getController();

  const [form] = Form.useForm();
  const { navigate } = useUtils();

  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [added, setAdded] = useState<boolean>(false);
  const [error, setError] = useState<boolean>(false);

  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];

  const handleSearch = (query: string) => {
    setSelected(null);

    const erc20Tokens = getTokenJson();

    if (!query) return setList(erc20Tokens);

    const filtered = Object.values(erc20Tokens).filter((token: any) => {
      if (!query || !token.name) return token;

      return token.name.toLowerCase().includes(query.toLowerCase());
    });

    setList(filtered);
  };

  const renderTokens = () => {
    const tokensList = list.length > 0 ? list : getTokenJson();

    for (const [key, value] of Object.entries(tokensList)) {
      const tokenValue: any = value;

      tokensList[key] = {
        ...tokenValue,
        contractAddress: key,
      };
    }

    return Object.values(tokensList).map((token: any) => (
      <li
        onClick={() => setSelected(token)}
        key={uniqueId()}
        className={`p-3 hover:text-brand-royalblue flex items-center justify-between text-xs border-b border-dashed cursor-pointer ${
          selected && selected.tokenSymbol === token.tokenSymbol
            ? 'text-brand-royalblue'
            : 'text-brand-white'
        }`}
      >
        <p className="font-rubik text-xl font-bold">{token.tokenSymbol}</p>

        {token.erc20 && <p>ERC-20</p>}
      </li>
    ));
  };

  const { t } = useTranslation();
  const addToken = async (token: ITokenEthProps) => {
    setIsLoading(true);
    try {
      const addTokenMethodResponse =
        await controller.wallet.assets.evm.addEvmDefaultToken(
          token,
          activeAccount.address,
          controller.wallet.ethereumTransaction.web3Provider
        );

      if (isBoolean(addTokenMethodResponse) || isNil(addTokenMethodResponse)) {
        setError(true);
        setIsLoading(false);

        return;
      }

      await controller.wallet.account.eth.saveTokenInfo(addTokenMethodResponse);

      setAdded(true);
    } catch (submitError) {
      setError(true);
    } finally {
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
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center text-center md:w-full"
      >
        <Form.Item
          name="search"
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
            placeholder={t('tokens.searchBySymbol')}
            className="input-small relative"
            onChange={(event) => handleSearch(event.target.value)}
          />
        </Form.Item>
      </Form>

      <div className="flex flex-col items-center justify-center w-full">
        <ul className="scrollbar-styled my-4 p-4 w-full h-60 overflow-auto">
          {renderTokens()}
        </ul>

        <NeutralButton
          type="button"
          loading={isLoading}
          onClick={
            selected ? () => addToken(selected) : () => navigate('/home')
          }
        >
          {selected ? `Import ${selected.tokenSymbol}` : 'Done'}
        </NeutralButton>
      </div>

      {added && (
        <DefaultModal
          show={added}
          title={t('tokens.tokenSuccessfullyAdded')}
          description={`${selected.tokenSymbol} ${t(
            'tokens.wasSuccessfullyAdded'
          )}`}
          onClose={() => navigate('/home')}
        />
      )}

      {error && (
        <ErrorModal
          show={error}
          title={t('tokens.verifyTheCurrentNetwork')}
          description={t('tokens.verifyTheCurrentNetworkMessage')}
          log={t('tokens.verifyTheCurrentNetworkMessage')}
          onClose={() => setError(false)}
        />
      )}
    </>
  );
};
