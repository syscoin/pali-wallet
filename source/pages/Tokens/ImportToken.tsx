import * as React from 'react';
import { useState, FC } from 'react';
import { useUtils } from 'hooks/index';
import { Form, Input } from 'antd';
import { SecondaryButton, Layout } from 'components/index';
import { formatUrl } from 'utils/index';
import { getController } from 'utils/browser';
// import { CoingeckoCoins } from 'scripts/Background/controllers/ControllerUtils';
import { useStore } from 'hooks/useStore';

export interface IToken {
  address: string;
  chainId: number;
  decimals: number;
  logoURI: string;
  name: string;
  symbol: string;
}

export const ImportToken: FC = () => {
  const controller = getController();

  const [form] = Form.useForm();
  const { navigate } = useUtils();

  const [filteredSearch, setFilteredSearch] = useState<IToken[]>([]);
  const [selected, setSelected] = useState<any>('');
  // const [isSelected, setIsSelected] = useState<boolean>(false);
  const [input, setInput] = useState<string>('');
  const { activeNetwork } = useStore();

  const handleSearch = async (query: string) => {
    const coins = await controller.utils.getTokenJson();
    let newList: any[] = [];

    if (query) {
      newList = coins.filter((item) => {
        const name = item.symbol.toLowerCase();
        const chain = item.chainId === activeNetwork.chainId;
        const typedValue = query.toLowerCase();
        const validate = !!(name.includes(typedValue) && chain);
        return validate;
      });

      setFilteredSearch(newList);

      return;
    }

    setFilteredSearch(coins);
    console.log(filteredSearch);
  };

  const addTokens = (filterArr: IToken[], index: number) => {
    controller.wallet.importWeb3Tokens(filterArr, index);
    console.log(filteredSearch[index]);
    navigate('/home');
  };
  return (
    <Layout title="IMPORT TOKEN">
      <Form
        form={form}
        id="send-form"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        onFinish={() => handleSearch(input)}
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
            className="pl-4 pr-8 py-3 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full outline-none md:w-full"
            onChange={(e) => setInput(e.target.value)}
          />
        </Form.Item>
      </Form>

      <div className="flex flex-col items-center justify-center w-full">
        <ul className="scrollbar-styled my-1 p-4 w-full h-72 overflow-auto">
          {filteredSearch &&
            filteredSearch.map((token: any, index) => (
              <li
                onClick={() => {
                  setSelected(token.symbol);
                  const element = document.getElementsByTagName('li');
                  handleSearch(input);
                  if (element) {
                    element[index].className += ' text-brand-royalblue';
                  }
                  console.log(selected);
                  addTokens(filteredSearch, index);
                }}
                key={index}
                className="my-2 py-2 w-full text-xs border-b border-dashed cursor-pointer"
              >
                <p>{formatUrl(token.symbol, 40)}</p>
              </li>
            ))}
        </ul>

        <div className="absolute bottom-12 md:static">
          <SecondaryButton type="button" onClick={() => handleSearch(input)}>
            Search
          </SecondaryButton>
        </div>
      </div>
    </Layout>
  );
};
