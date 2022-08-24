import { Form, Input } from 'antd';
import { uniqueId } from 'lodash';
import React from 'react';
import { useState, FC } from 'react';

import { getTokenJson } from '@pollum-io/sysweb3-utils';

import { SecondaryButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { getController } from 'utils/browser';

export const ImportToken: FC = () => {
  const controller = getController();

  const [form] = Form.useForm();
  const { navigate, alert } = useUtils();

  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);

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
    const tokensList = list || getTokenJson();

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

  const addToken = async (token: any) => {
    try {
      await controller.wallet.account.eth.saveTokenInfo(token);

      alert.removeAll();
      alert.success(
        `${token.tokenSymbol} successfully added to your assets list.`
      );
    } catch (error) {
      alert.removeAll();
      alert.error(
        `Can't add ${token.tokenSymbol} to your wallet. Try again later.`
      );

      throw new Error(error);
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
        className="standard flex flex-col gap-3 items-center justify-center mt-4 text-center md:w-full"
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
            placeholder="Search by symbol"
            className="large"
            onChange={(event) => handleSearch(event.target.value)}
          />
        </Form.Item>
      </Form>

      <div className="flex flex-col items-center justify-center w-full">
        <ul className="scrollbar-styled my-1 p-4 w-full h-72 overflow-auto">
          {renderTokens()}
        </ul>

        <SecondaryButton
          type="button"
          onClick={
            selected ? () => addToken(selected) : () => navigate('/home')
          }
        >
          {selected ? `Import ${selected.tokenSymbol}` : 'Done'}
        </SecondaryButton>
      </div>
    </>
  );
};
