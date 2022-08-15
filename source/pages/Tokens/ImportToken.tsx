import { Form, Input } from 'antd';
import * as React from 'react';
import { useState, FC, useEffect } from 'react';
import { useSelector } from 'react-redux';

import {
  getToken,
  getSearch,
  ICoingeckoSearchResultToken,
  ICoingeckoToken,
} from '@pollum-io/sysweb3-utils';

import {
  SecondaryButton,
  Layout,
  Icon,
  Loading,
  Tooltip,
} from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { formatUrl, ellipsis } from 'utils/index';

export const ImportToken: FC = () => {
  const controller = getController();

  const [form] = Form.useForm();
  const { navigate, alert, useCopyClipboard } = useUtils();
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  const [copied, copy] = useCopyClipboard();
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const erc20Tokens = activeAccount.assets.filter((asset: any) => !asset.isNFT);

  const [tokens, setTokens] =
    useState<ICoingeckoSearchResultToken[]>(erc20Tokens);
  const [selected, setSelected] = useState<ICoingeckoToken | null>(null);

  const handleSearch = async (query: string) => {
    setSelected(null);

    const { coins } = await getSearch(query);

    let newList: ICoingeckoSearchResultToken[] = [];

    if (query) {
      newList = coins.filter(async (item) => {
        const name = item.symbol.toLowerCase();
        const typedValue = query.toLowerCase();

        const tokenData = await getToken(item.id);

        const validate =
          !!name.includes(typedValue) && tokenData.contractAddress;

        return validate;
      });

      setTokens(newList);

      return;
    }

    setTokens(coins);
  };

  const addToken = async (token: ICoingeckoToken) => {
    try {
      await controller.wallet.account.eth.saveTokenInfo(token);

      alert.removeAll();
      alert.success(`${token.symbol} successfully added to your assets list.`);
    } catch (error) {
      alert.removeAll();
      alert.error(`Can't add ${token.symbol} to your wallet. Try again later.`);

      throw new Error(error);
    }
  };

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success('Token address successfully copied');
  }, [copied]);

  const handleSelectToken = async (token: ICoingeckoSearchResultToken) => {
    setIsLoading(true);

    setSelected(await getToken(token.id));

    setIsLoading(false);
  };

  return (
    <Layout title="IMPORT TOKEN">
      <Form
        validateMessages={{ default: '' }}
        form={form}
        id="send-form"
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
          {tokens ? (
            !selected &&
            tokens.map((token) => (
              <li
                onClick={() => handleSelectToken(token)}
                key={token.id}
                className="p-2 hover:text-brand-royalblue text-brand-white text-xs border-b border-dashed cursor-pointer"
              >
                <p>{formatUrl(token.symbol, 40)}</p>
              </li>
            ))
          ) : (
            <li className="p-2 text-brand-royalblue hover:text-brand-royalblue text-xs border-b border-dashed cursor-pointer">
              <p>{formatUrl(selected?.symbol || '', 40)}</p>
            </li>
          )}

          {selected && (
            <div className="flex flex-col gap-y-4 items-start justify-start mx-auto my-6 p-4 max-w-xs text-left text-sm bg-bkg-3 border border-brand-royalblue rounded-lg">
              <div className="flex gap-x-2 justify-start w-full">
                {selected.image.thumb && (
                  <img src={selected.image.thumb} alt="token thumb" />
                )}

                <p className="font-rubik text-2xl font-bold">
                  {formatUrl(selected.symbol)}
                </p>
              </div>

              {selected.contractAddress && (
                <div
                  onClick={() => copy(selected.contractAddress)}
                  className="flex gap-x-0.5 items-center justify-center hover:text-brand-royalblue text-brand-white"
                >
                  <p className="cursor-pointer">
                    Address: {ellipsis(selected.contractAddress)}
                  </p>

                  <Icon name="copy" className="mb-1.5" />
                </div>
              )}

              <p>Name: {formatUrl(selected.name)}</p>

              <p>Market cap rank: {selected.marketCapRank}</p>

              <p className="max-w-xs break-all text-xs">
                {/* @ts-ignore */}
                {formatUrl(selected.description.en, 140)}
              </p>
            </div>
          )}
        </ul>

        <div className="absolute bottom-12 md:static">
          <Tooltip
            content={`${
              selected && selected.contractAddress
                ? ''
                : 'Pali could not find the contract address for this token'
            }`}
          >
            <SecondaryButton
              type="button"
              disabled={Boolean(selected && !selected.contractAddress)}
              onClick={
                selected ? () => addToken(selected) : () => navigate('/home')
              }
            >
              {selected ? 'Import' : 'Done'}
            </SecondaryButton>
          </Tooltip>
        </div>
      </div>

      {isLoading && <Loading />}
    </Layout>
  );
};
