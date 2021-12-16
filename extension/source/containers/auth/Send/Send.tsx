import * as React from 'react';
import {
  ChangeEvent,
  useState,
  useCallback,
  useMemo,
  useEffect,
  Fragment,
  FC,
} from 'react';
import { Button, IconButton, Icon, Select } from 'components/index';;
import { useController, usePrice, useStore, useUtils, useAccount } from 'hooks/index';
import { Form, Input } from 'antd';
import { Switch, Menu, Transition } from '@headlessui/react';
import { AuthViewLayout } from 'containers/common/Layout';
import { Assets } from 'scripts/types';
import { ChevronDoubleDownIcon } from '@heroicons/react/solid';
import { Tooltip } from 'components/Tooltip';

interface ISend {
  initAddress?: string;
}
export const Send: FC<ISend> = ({ initAddress = '' }) => {
  const getFiatAmount = usePrice();
  const controller = useController();
  // const { alert, history } = useUtils();
  const { changingNetwork, activeNetwork } = useStore();
  const { activeAccount } = useAccount();

  const [address, setAddress] = useState<string>(initAddress);
  const [amount, setAmount] = useState<string>('');
  const [fee, setFee] = useState<string>('0.00001');
  const [recommend, setRecommend] = useState<number>(0);
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [verifyAddress, setVerifyAddress] = useState<boolean>(true);
  const [ZDAG, setZDAG] = useState<boolean>(false);
  const [selectedAsset, setSelectedAsset] = useState<Assets | null>(null);
  const [expanded, setExpanded] = useState<boolean>(false);

  // const onSubmit = (data: any) => {
  //   const {
  //     address,
  //     amount,
  //     fee
  //   } = data;

  //   if (Number(fee) > 0.1) {
  //     alert.removeAll();
  //     alert.error(`Error: Fee too high, maximum 0.1 SYS`, { timeout: 2000 });

  //     return;
  //   }

  //   if (selectedAsset) {
  //     try {
  //       controller.wallet.account.updateTempTx({
  //         fromAddress: accounts.find(element => element.id === activeAccountId)!.address.main,
  //         toAddress: address,
  //         amount: Number(amount - fee),
  //         fee,
  //         token: selectedAsset.assetGuid,
  //         isToken: true,
  //         rbf: !checked,
  //       });

  //       history.push('/send/confirm');
  //     } catch (error) {
  //       alert.removeAll();
  //       alert.error('An internal error has occurred.');
  //     }

  //     return;
  //   }

  //   controller.wallet.account.updateTempTx({
  //     fromAddress: accounts.find(element => element.id === activeAccountId)!.address.main,
  //     toAddress: address,
  //     amount: Number(amount - fee),
  //     fee,
  //     token: null,
  //     isToken: false,
  //     rbf: true,
  //   });

  //   history.push('/send/confirm');
  // };

  // const handleAmountChange = useCallback(
  //   (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
  //     setAmount(event.target.value);
  //   },
  //   []
  // );

  // const handleFeeChange = useCallback(
  //   (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
  //     setFee(event.target.value.replace(/[^0-9.]/g, '').replace(/(\..*?)\..*/g, '$1'));

  //     if (Number(event.target.value) > 0.1) {
  //       alert.removeAll();
  //       alert.error(`Error: Fee too high, maximum 0.1 SYS.`, { timeout: 2000 });

  //       return;
  //     }
  //   },
  //   []
  // );


  // const handleGetFee = () => {
  //   controller.wallet.account.getRecommendFee().then((response: any) => {
  //     setRecommend(response);
  //     setFee(response.toString());
  //   });
  // };

  const handleAssetSelected = (item: number) => {
    if (activeAccount?.assets) {
      const getAsset = activeAccount?.assets.find((asset: Assets) => asset.assetGuid == item);

      if (getAsset) {
        setSelectedAsset(getAsset);

        return;
      }

      setSelectedAsset(null);
    }
  };

  const getAssetBalance = () => {
    if (selectedAsset) {
      return `${(selectedAsset.balance / 10 ** selectedAsset.decimals).toFixed(selectedAsset.decimals)} ${selectedAsset.symbol}`;
    }

    return `${activeAccount!.balance.toFixed(8)} SYS`;
  }

  const onSubmit = (data: any) => {
    console.log('submit', data);
  }

  return (
    <AuthViewLayout title="SEND SYS">
      {confirmed ? (
        <div>
          confirmed
        </div>
      ) : (
        <div className="mt-4">
          <p className="flex flex-col justify-center text-center items-center font-rubik">
            <span className="text-brand-royalBlue font-thin font-poppins">
              Balance
            </span>

            {getAssetBalance()}
          </p>

          <Form
            id="send"
            name="send"
            labelCol={{ span: 8 }}
            wrapperCol={{ span: 8 }}
            initialValues={{ remember: true }}
            onFinish={onSubmit}
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
                    required: true,
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
                            onClick={() => handleAssetSelected(-1)}
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
                                onClick={() => handleAssetSelected(item.assetGuid)}
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
                    content="Pali verify your address to check if it is a valid SYS address. It's useful disable this verification if you want to send to specific type of addresses, like legacy. Only disable this verification if you are fully aware of what you are doing."
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
                    content="asdasda"
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
                  max: Number(getAssetBalance()),
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
                  min: 0,
                  max: 1,
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
                ≈ {!selectedAsset ? getFiatAmount(Number(amount) + Number(fee), 6) : getFiatAmount(Number(fee), 6)}
              </span>
            </p>

            <Button
              type="submit"
              className="bg-brand-navydarker"
              classNameBorder="absolute bottom-12"
            >
              Next
            </Button>
          </Form>
        </div>
      )}
    </AuthViewLayout>
  );
};
