import * as React from 'react';
import { useState, FC } from 'react';
import { useUtils } from 'hooks/index';
import { Form, Input } from 'antd';
import { SecondaryButton } from 'components/index';
import { formatUrl } from 'utils/index';
import { getController } from 'utils/browser';
import { CoingeckoCoins } from 'scripts/Background/controllers/ControllerUtils';

export const ImportToken: FC = () => {
  const controller = getController();

  const [form] = Form.useForm();
  const { navigate } = useUtils();

  const [filteredSearch, setFilteredSearch] = useState<CoingeckoCoins[]>([]);
  const [selected, setSelected] = useState<string>('');

  const handleSearch = async ({ query }: { query: string }) => {
    const {
      data: { coins },
    } = await controller.utils.getSearch(query);
    let newList: CoingeckoCoins[] = [];

    if (query) {
      newList = coins.filter((item) => {
        const id = item.id.toLowerCase();
        const typedValue = query.toLowerCase();

        return id.includes(typedValue);
      });

      setFilteredSearch(newList);

      return;
    }

    setFilteredSearch(coins);
  };

  return (
    <>
      <Form
        form={form}
        id="send-form"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        onFinish={handleSearch}
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
          />
        </Form.Item>
      </Form>

      <div className="flex flex-col items-center justify-center w-full">
        <ul className="scrollbar-styled my-1 p-4 w-full h-72 overflow-auto">
          {filteredSearch &&
            filteredSearch.map((token: any) => (
              <li
                onClick={() => setSelected(token.id)}
                key={token}
                className={`${
                  selected ? 'border-brand-royalblue' : 'border-gray-500'
                } my-2 py-2 w-full text-xs border-b border-dashed`}
              >
                <p>{formatUrl(token.symbol, 40)}</p>
              </li>
            ))}
        </ul>

        <div className="absolute bottom-12 md:static">
          <SecondaryButton type="button" onClick={() => navigate('/home')}>
            Close
          </SecondaryButton>
        </div>
      </div>
    </>
  );
};
