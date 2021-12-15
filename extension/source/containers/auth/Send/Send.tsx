import * as React from 'react';
import {
  ChangeEvent,
  useState,
  useCallback,
  useMemo,
  useEffect,
  FC,
} from 'react';
import { Header } from 'containers/common/Header';
import { Button, IconButton, Icon, Select } from 'components/index';;
import { useController, usePrice, useStore, useUtils, useAccount } from 'hooks/index';
import { Form, Input } from 'antd';
import { AuthViewLayout } from 'containers/common/Layout';
import { Assets } from 'scripts/types';

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
  const [verifyAddress, setVerifyAddress] = useState<boolean>(false);
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

  // const handleAddressChange = useCallback(
  //   (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
  //     setAddress(event.target.value.trim());
  //   },
  //   []
  // );

  // const handleTypeChanged = useCallback(
  //   (
  //     checked: boolean
  //   ) => {
  //     setChecked(checked);
  //   },
  //   []
  // )

  // const handleGetFee = () => {
  //   controller.wallet.account.getRecommendFee().then((response: any) => {
  //     setRecommend(response);
  //     setFee(response.toString());
  //   });
  // };

  // const handleAssetSelected = (item: any) => {
  //   const selectedAsset = accounts.find(element => element.id === activeAccountId)!.assets.filter((asset: Assets) => asset.assetGuid == item);

  //   if (selectedAsset[0]) {
  //     setSelectedAsset(selectedAsset[0]);

  //     return;
  //   }

  //   setSelectedAsset(null);
  // };

  // useEffect(handleGetFee, []);

  // const checkAssetBalance = () => {
  //   return Number(selectedAsset ?
  //     (selectedAsset.balance / 10 ** selectedAsset.decimals).toFixed(selectedAsset.decimals) :
  //     accounts.find(element => element.id === activeAccountId)!.balance.toFixed(8))
  // }

  // const showAssetBalance = () => {
  //   return (selectedAsset ?
  //     (selectedAsset.balance / 10 ** selectedAsset.decimals).toFixed(selectedAsset.decimals) :
  //     accounts.find(element => element.id === activeAccountId)!.balance.toFixed(8))
  // }

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
        <div>
          <Form
            name="basic"
            labelCol={{ span: 8 }}
            wrapperCol={{ span: 8 }}
            initialValues={{ remember: true }}
            onFinish={onSubmit}
            autoComplete="off"
            className="flex justify-center items-center flex-col gap-4 mt-8 text-center"
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
              />
            </Form.Item>

            <div className="flex justify-center items-center">
              <Form.Item
                name="asset"
                className=""
                hasFeedback
                rules={[
                  {
                    required: true,
                    message: ''
                  },
                ]}
              >
                <Select
                  className="bg-brand-white"
                  expanded={expanded}
                  title={selectedAsset}
                  setExpanded={setExpanded}
                >
                  <li>sys</li>
                  <li>eth</li>
                </Select>
              </Form.Item>

              <div className="flex justify-center items-center">
                <Form.Item
                  name="asset"
                  className=""
                  hasFeedback
                  rules={[
                    {
                      required: true,
                      message: ''
                    },
                  ]}
                >
                  <Select
                    className="bg-brand-white"
                    expanded={expanded}
                    title={selectedAsset}
                    setExpanded={setExpanded}
                  >
                    <li>sys</li>
                    <li>eth</li>
                  </Select>
                </Form.Item>

                <Form.Item
                  name="asset"
                  className=""
                  hasFeedback
                  rules={[
                    {
                      required: true,
                      message: ''
                    },
                  ]}
                >
                  <Select
                    className="bg-brand-white"
                    expanded={expanded}
                    title={selectedAsset}
                    setExpanded={setExpanded}
                  >
                    <li>sys</li>
                    <li>eth</li>
                  </Select>
                </Form.Item>
              </div>
            </div>

            <Form.Item
              name="amount"
              hasFeedback
              rules={[
                {
                  required: true,
                  message: ''
                },
              ]}
            >
              <Input
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
                  message: ''
                },
              ]}
            >
              <Input
                type="number"
                placeholder="Fee"
              />
            </Form.Item>

            <p>
              With current network conditions we recommend a fee of 0.00001 SYS:
              
              <span>{recommend}</span>
            </p>

            <Button
              type="submit"
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
