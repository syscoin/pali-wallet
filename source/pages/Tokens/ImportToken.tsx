import * as React from 'react';
import { useState, FC, useEffect } from 'react';
import { useUtils, useStore } from 'hooks/index';
import { Form, Input } from 'antd';
import {
  SecondaryButton,
  Layout,
  Icon,
  Loading,
  Tooltip,
} from 'components/index';
import { formatUrl, ellipsis } from 'utils/index';
import { getController } from 'utils/browser';
import { IToken } from 'types/transactions';
import { CoingeckoCoins } from 'types/controllers';

export const ImportToken: FC = () => {
  const controller = getController();

  const [form] = Form.useForm();
  const { navigate, alert, useCopyClipboard } = useUtils();
  const { activeAccount } = useStore();

  const [copied, copy] = useCopyClipboard();
  const [filteredSearch, setFilteredSearch] = useState<CoingeckoCoins[]>(
    activeAccount.assets
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selected, setSelected] = useState<CoingeckoCoins | any>(null);

  const handleSearch = async (query: string) => {
    setSelected(null);

    const {
      data: { coins },
    } = await controller.utils.getSearch(query);

    let newList: CoingeckoCoins[] = [];

    if (query) {
      newList = coins.filter(async (item) => {
        const name = item.symbol.toLowerCase();
        const typedValue = query.toLowerCase();

        const { data } = await controller.utils.getDataForToken(item.id);

        const validate = !!name.includes(typedValue) && data.contract_address;

        return validate;
      });

      setFilteredSearch(newList);

      return;
    }

    setFilteredSearch(coins);
  };

  const addToken = async (token: IToken) => {
    try {
      await controller.wallet.account.sys.saveTokenInfo(token);

      alert.removeAll();
      alert.success(`${token.symbol} successfully added to your assets list.`);
    } catch (error) {
      alert.removeAll();
      alert.error(`Can't add ${token.symbol} to your wallet. Try again later.`);
    }
  };

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success('Token address successfully copied');
  }, [copied]);

  const handleSelectToken = async (token: CoingeckoCoins) => {
    setIsLoading(true);

    const { data } = await controller.utils.getDataForToken(token.id);

    setSelected({
      ...token,
      explorer_link: data.links ? data.links.blockchain_site[0] : '',
      contract_address: data.contract_address,
      description: data.description ? data.description.en : '',
    });

    setIsLoading(false);
  };

  return (
    <Layout title="IMPORT TOKEN">
      <Form
        form={form}
        id="send-form"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        autoComplete="off"
        className="flex flex-col gap-3 items-center justify-center mt-4 text-center md:w-full"
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
          {filteredSearch ? (
            !selected &&
            filteredSearch.map((token) => (
              <li
                onClick={() => handleSelectToken(token)}
                key={token.id}
                className={`${
                  selected && selected.id === token.id
                    ? 'text-brand-royalblue'
                    : 'text-brand-white'
                } p-2 hover:text-brand-royalblue text-xs border-b border-dashed cursor-pointer`}
              >
                <p>{formatUrl(token.symbol, 40)}</p>
              </li>
            ))
          ) : (
            <li className="p-2 text-brand-royalblue hover:text-brand-royalblue text-xs border-b border-dashed cursor-pointer">
              <p>{formatUrl(selected.symbol, 40)}</p>
            </li>
          )}

          {selected && (
            <div className="flex flex-col gap-y-4 items-start justify-start mx-auto my-6 p-4 max-w-xs text-left text-sm bg-bkg-3 border border-brand-royalblue rounded-lg">
              <div className="flex gap-x-2 justify-start w-full">
                <img src={selected.thumb} alt="token thumb" />

                <p className="font-rubik text-2xl font-bold">
                  {formatUrl(selected.symbol)}
                </p>
              </div>

              {selected.contract_address && (
                <div
                  onClick={() => copy(selected.contract_address)}
                  className="flex gap-x-0.5 items-center justify-center hover:text-brand-royalblue text-brand-white"
                >
                  <p className="cursor-pointer">
                    Address: {ellipsis(selected.contract_address)}
                  </p>

                  <Icon name="copy" className="mb-1.5" />
                </div>
              )}

              <p>Name: {formatUrl(selected.name)}</p>

              <p>Market cap rank: {selected.market_cap_rank}</p>

              <p className="max-w-xs break-all text-xs">
                {formatUrl(selected.description, 140)}
              </p>
            </div>
          )}
        </ul>

        <div className="absolute bottom-12 md:static">
          <Tooltip
            content={`${
              selected && selected.contract_address
                ? ''
                : 'Pali could not find the contract address for this token'
            }`}
          >
            <SecondaryButton
              type="button"
              disabled={selected && !selected.contract_address}
              onClick={
                selected ? () => addToken(selected) : () => navigate('/home')
              }
            >
              {selected ? 'Import' : 'Done'}
            </SecondaryButton>
          </Tooltip>
        </div>
      </div>

      {isLoading && <Loading opacity={60} />}
    </Layout>
  );
};
