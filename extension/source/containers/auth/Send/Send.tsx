import * as React from 'react';
import {
  useState,
  Fragment,
  FC,
} from 'react';

import {
  useController,
  // usePrice,
  useStore,
  useUtils,
  useAccount,
  useTransaction
} from 'hooks/index';

import { Form, Input } from 'antd';
import { Switch, Menu, Transition } from '@headlessui/react';
import { AuthViewLayout } from 'containers/common/Layout';
import { Button, Tooltip } from 'components/index';
import { Assets } from 'scripts/types';
import { ChevronDoubleDownIcon } from '@heroicons/react/solid';

interface ISend {
  initAddress?: string;
}

export const Send: FC<ISend> = () => {
  // const getFiatAmount = usePrice();
  const controller = useController();


  const { alert, history } = useUtils();
  const { getAssetBalance, updateSendTemporaryTx } = useTransaction();
  const { activeAccount } = useAccount();
  const { activeNetwork } = useStore();

  const [verifyAddress, setVerifyAddress] = useState<boolean>(false);
  const [ZDAG, setZDAG] = useState<boolean>(false);
  const [selectedAsset, setSelectedAsset] = useState<Assets | null>(null);

  const handleSelectedAsset = (item: number) => {
    if (activeAccount?.assets) {
      const getAsset = activeAccount?.assets.find((asset: Assets) => asset.assetGuid == item);

      if (getAsset) {
        setSelectedAsset(getAsset);

        return;
      }

      setSelectedAsset(null);
    }
  };

  const [form] = Form.useForm();

  const nextStep = (data: any) => {
    const {
      receiver,
      amount,
      fee
    } = data;

    // if (fee > 0.1) {
    //   alert.removeAll();
    //   alert.error(`Error: Fee too high, maximum 0.1 SYS`, {
    //     timeout: 2000
    //   });

    //   return;
    // }

    if (selectedAsset) {
      try {
        updateSendTemporaryTx({
          receiver,
          amount,
          fee,
          token: selectedAsset.assetGuid,
          controller,
          activeAccount,
          history
        });
      } catch (error) {
        alert.removeAll();
        alert.error('An internal error has occurred.');
      }

      return;
    }

    updateSendTemporaryTx({
      receiver,
      amount,
      fee,
      token: null,
      controller,
      activeAccount,
      history
    });
  }

  const SendForm = (
  ) => (
    <div className="mt-4">
      <p className="flex flex-col justify-center text-center items-center font-rubik">
        <span className="text-brand-royalBlue font-thin font-poppins">
          Balance
        </span>

        {getAssetBalance(selectedAsset)}
      </p>

      <Form
        form={form}
        id="send"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={{ remember: true }}
        onFinish={nextStep}
        autoComplete="off"
        className="flex justify-center items-center flex-col gap-3 mt-4 text-center"
      >
        <Form.Item
          name="receiver"
          hasFeedback
          rules={[
            {
              required: true,
              message: ''
            },
            () => ({
              validator(_, value) {
                if (!value || controller.wallet.account.isValidSYSAddress(value, activeNetwork, verifyAddress)) {
                  return Promise.resolve();
                }

                return Promise.reject('');
              },
            }),
          ]}
        >
          <Input
            type="text"
            placeholder="Receiver"
            className="rounded-full py-3 pr-8 w-72 pl-4 bg-brand-navyborder border border-brand-royalBlue text-sm"
          />
        </Form.Item>

        <div className="flex justify-center items-center">
          <Form.Item
            name="asset"
            className=""
            rules={[
              {
                required: false,
                message: ''
              },
            ]}
          >
            <Menu
              as="div"
              className="relative inline-block text-left"
            >
              <Menu.Button
                disabled={!activeAccount?.assets}
                className="bg-brand-navyborder border border-brand-royalBlue inline-flex justify-center w-full px-4 py-3 text-sm font-medium text-white rounded-full hover:bg-opacity-30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75"
              >
                {selectedAsset?.symbol || 'SYS'}

                <ChevronDoubleDownIcon
                  className="w-5 h-5 ml-2 -mr-1 text-violet-200 hover:text-violet-100"
                  aria-hidden="true"
                />
              </Menu.Button>

              <Transition
                as={Fragment}
                enter="transition ease-out duration-100"
                enterFrom="transform opacity-0 scale-95"
                enterTo="transform opacity-100 scale-100"
                leave="transition ease-in duration-75"
                leaveFrom="transform opacity-100 scale-100"
                leaveTo="transform opacity-0 scale-95"
              >
                {activeAccount?.assets && activeAccount?.assets.length > 0 && (
                  <Menu.Items
                    className="overflow-auto h-56 bg-brand-navyborder border border-brand-royalBlue text-brand-white w-40 font-poppins shadow-2xl absolute z-10 left-0 mt-2 origin-top-right divide-y divide-gray-100 rounded-2xl ring-1 ring-black ring-opacity-5 focus:outline-none p-1"
                  >
                    <Menu.Item>
                      <button
                        onClick={() => handleSelectedAsset(-1)}
                        className="hover:text-brand-royalBlue text-brand-white font-poppins transition-all duration-300 group flex border-0 border-transparent items-center w-full px-2 py-2 text-sm justify-between"
                      >
                        <p>SYS</p>

                        <small>
                          Native
                        </small>
                      </button>
                    </Menu.Item>

                    {activeAccount?.assets.map((item) => {
                      return (
                        <Menu.Item>
                          <button
                            onClick={() => handleSelectedAsset(item.assetGuid)}
                            className="hover:text-brand-royalBlue text-brand-white font-poppins transition-all duration-300 group flex border-0 border-transparent items-center w-full px-2 py-2 text-sm justify-between"
                          >
                            <p>{item.symbol}</p>

                            <small>
                              {controller.wallet.account.isNFT(item.assetGuid) ? 'NFT' : 'SPT'}
                            </small>
                          </button>
                        </Menu.Item>
                      )
                    })}
                  </Menu.Items>
                )}
              </Transition>
            </Menu>
          </Form.Item>

          <div className="mx-2 flex w-48 gap-x-0.5 justify-center items-center">
            <Form.Item
              name="verify"
              className="flex-1 w-32 bg-brand-navyborder border border-brand-royalBlue rounded-l-full text-center"
              rules={[
                {
                  required: false,
                  message: ''
                },
              ]}
            >
              <Tooltip
                contentClassName="text-brand-white h-4"
                content="Pali verifies your address to check if it is a valid SYS address. It's useful disable this verification if you want to send to specific type of addresses, like legacy. Only disable this verification if you are fully aware of what you are doing."
              >
                <p className="text-10px">
                  Verify address
                </p>
              </Tooltip>

              <Switch
                checked={verifyAddress}
                onChange={setVerifyAddress}
                className="relative inline-flex items-center h-4 rounded-full w-9 border border-brand-royalBlue"
              >
                <span className="sr-only">Verify address</span>

                <span
                  className={`${verifyAddress ? 'translate-x-6 bg-brand-green' : 'translate-x-1'
                    } inline-block w-2 h-2 transform bg-brand-error rounded-full`}
                />
              </Switch>
            </Form.Item>

            <Form.Item
              name="ZDAG"
              className="flex-1 w-32 rounded-r-full text-center  bg-brand-navyborder border border-brand-royalBlue"
              rules={[
                {
                  required: false,
                  message: ''
                },
              ]}
            >
              <Tooltip
                contentClassName="text-brand-white h-4"
                content="Disable this option for Replace-by-fee (RBF) and enable for Z-DAG, a exclusive Syscoin feature. Z-DAG enables faster transactions but should not be used for high amounts."
              >
                <p className="text-10px">
                  Z-DAG
                </p>
              </Tooltip>

              <Switch
                checked={ZDAG}
                onChange={setZDAG}
                className="bg-transparent relative inline-flex items-center h-4 rounded-full w-9 border border-brand-royalBlue"
              >
                <span className="sr-only">Z-DAG</span>

                <span
                  className={`${ZDAG ? 'bg-brand-green translate-x-6' : 'bg-brand-error translate-x-1'
                    } inline-block w-2 h-2 transform rounded-full`}
                />
              </Switch>
            </Form.Item>
          </div>
        </div>

        <Form.Item
          name="amount"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
              min: 0,
              max: Number(getAssetBalance(selectedAsset)),
            },
          ]}
        >
          <Input
            className="rounded-full py-3 pr-8 w-72 pl-4 bg-brand-navyborder border border-brand-royalBlue text-sm"
            type="number"
            placeholder="Amount"
          />
        </Form.Item>

        <Form.Item
          name="fee"
          hasFeedback
          rules={[
            {
              required: true,
              message: '',
            },
          ]}
        >
          <Input
            className="rounded-full py-3 pr-8 w-72 pl-4 bg-brand-navyborder border border-brand-royalBlue text-sm"
            type="number"
            placeholder="Fee"
          />
        </Form.Item>

        <p className="flex justify-center items-center flex-col text-center p-0 text-brand-royalBlue text-xs mx-14">
          With current network conditions we recommend a fee of 0.00001 SYS

          <span className="font-rubik text-brand-white mt-0.5">
            {/* ≈ {selectedAsset ? getFiatAmount(Number(form.) + Number(fee), 6) : getFiatAmount(Number(fee), 6)} */}
            0
          </span>
        </p>

        <Button
          type="submit"
          className="bg-brand-navydarker"
        >
          Next
        </Button>
      </Form>
    </div>
  )

  return (
    <AuthViewLayout title="SEND SYS">
      <SendForm />
    </AuthViewLayout>
  );
};
