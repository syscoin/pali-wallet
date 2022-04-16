import * as React from 'react';
import { useState, FC, useEffect } from 'react';
import { useUtils } from 'hooks/index';
import { Form, Input } from 'antd';
import { SecondaryButton, Layout, Icon } from 'components/index';
import { formatUrl, ellipsis } from 'utils/index';
import { getController } from 'utils/browser';
import placeholder from 'assets/images/placeholder.png';
// import { CoingeckoCoins } from 'scripts/Background/controllers/ControllerUtils';
import { useStore } from 'hooks/useStore';
import { IToken } from 'types/transactions';

export const ImportToken: FC = () => {
  const controller = getController();

  const [form] = Form.useForm();
  const { navigate, alert, useCopyClipboard } = useUtils();

  const [copied, copy] = useCopyClipboard();
  const [filteredSearch, setFilteredSearch] = useState<IToken[]>([]);
  const [selected, setSelected] = useState<IToken | any>(null);
  const [edited, setEdited] = useState<boolean>(false);
  const { activeNetwork } = useStore();

  const handleSearch = async (query: string) => {
    setSelected(null);

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
  };

  const addToken = (token: IToken) => {
    controller.wallet.account.saveTokenInfo(token);

    alert.removeAll();
    alert.success(`${token.symbol} successfully added to your assets list.`);
  };

  useEffect(() => {
    if (!copied) return;

    alert.removeAll();
    alert.success('Token address successfully copied');
  }, [copied]);

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
            className="pl-4 pr-8 py-3 w-72 text-sm bg-fields-input-primary border border-fields-input-border focus:border-fields-input-borderfocus rounded-full outline-none md:w-full"
            onChange={(event) => handleSearch(event.target.value)}
          />
        </Form.Item>
      </Form>

      <div className="flex flex-col items-center justify-center w-full">
        <ul className="scrollbar-styled my-1 p-4 w-full h-72 overflow-auto">
          {filteredSearch &&
            !selected &&
            filteredSearch.map((token: any, index) => (
              <li
                onClick={() => setSelected(token)}
                key={index}
                className={`${
                  selected && selected.address === token.address
                    ? 'text-brand-royalblue'
                    : 'text-brand-white'
                } p-2 hover:text-brand-royalblue text-xs border-b border-dashed cursor-pointer`}
              >
                <p>{formatUrl(token.symbol, 40)}</p>
              </li>
            ))}

          {selected && (
            <div className="flex flex-col gap-y-4 my-6 p-4 pr-28 max-w-sm text-sm bg-bkg-3 border border-brand-royalblue rounded-lg">
              <div className="flex gap-y-4 items-center justify-start w-full">
                <img
                  className="w-8 h-8 rounded-md"
                  src={selected.logoURI ? selected.logoURI : placeholder}
                  alt="Token logo"
                />

                <p className="mx-2 font-rubik text-2xl font-bold">
                  {selected.symbol}
                </p>
              </div>

              <div
                onClick={() => copy(selected.address)}
                className="flex gap-x-0.5 items-center justify-center hover:text-brand-royalblue text-brand-white"
              >
                <p className="cursor-pointer">
                  Address: {ellipsis(selected.address)}
                </p>

                <Icon name="copy" className="mb-1.5" />
              </div>

              <p>Name: {formatUrl(selected.name)}</p>

              <p>Chain ID: {selected.chainId}</p>
            </div>
          )}
        </ul>

        <div className="absolute bottom-12 md:static">
          <SecondaryButton
            type="button"
            onClick={
              selected ? () => addToken(selected) : () => navigate('/home')
            }
          >
            {selected ? 'Import' : 'Done'}
          </SecondaryButton>
        </div>
      </div>
    </Layout>
  );
};
