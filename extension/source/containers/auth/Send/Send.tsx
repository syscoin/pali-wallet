import * as React from 'react';
import {
  // ChangeEvent,
  // useState,
  // useCallback,
  // useMemo,
  // useEffect,
  FC,
} from 'react';
import { Header } from 'containers/common/Header';
// import { Button, IconButton, Icon } from 'components/index';;
// import { useController, useFiat, useStore, useUtils } from 'hooks/index';
// import { Assets } from 'scripts/types';
// import { Form, Input } from 'antd';

interface ISend {
  initAddress?: string;
}
export const Send: FC<ISend> = (/*{ initAddress = '' }*/) => {
  // // const getFiatAmount = useFiat();
  // const controller = useController();
  // const { alert, history } = useUtils();
  // const { accounts, activeAccountId, activeNetwork, changingNetwork } = useStore();
  
  // const [address, setAddress] = useState<string>(initAddress);
  // const [amount, setAmount] = useState<string>('');
  // const [fee, setFee] = useState<string>('0.00001');
  // const [recommend, setRecommend] = useState<number>(0);
  // const [checked, setChecked] = useState<boolean>(false);
  // const [selectedAsset, setSelectedAsset] = useState<Assets | null>(null);
  // const [expanded, setExpanded] = useState<boolean>(false);

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

  return (
    <div className="bg-brand-gray">
      <Header normalHeader />

      <p>send component - replace with antd</p>

      {/* <IconButton
        type="primary"
        shape="circle"
        onClick={() => history.goBack()}
      >
        <Icon name="arrow-left" className="w-4 bg-brand-graydark100 text-brand-white" />
      </IconButton>

      <Form
        name="basic"
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 8 }}
        initialValues={{ remember: true }}
        onFinish={onSubmit}
        autoComplete="off"
        className="flex justify-center items-center flex-col gap-4 mt-8 text-center"
      >
        <section>Send {selectedAsset ? selectedAsset.symbol : "SYS"}</section>

        <section>
          <div>
            Balance:{' '}
            {changingNetwork ? (
              <Icon name="loading" className="w-4 bg-brand-graydark100 text-brand-white" />
            ) : (
              <span>{showAssetBalance()}</span>
            )}

            {selectedAsset
              ? selectedAsset.symbol
              : <small>{activeNetwork == "testnet" ? "TSYS" : "SYS"}</small>}
          </div>
        </section>

        <Form.Item
          label="Recipient Address"
          name="address"
          hasFeedback
          rules={[
            {
              required: true,
              message: ''
            },
            ({ }) => ({
              validator(_, value) {
                if (controller.wallet.account.isValidSYSAddress(value, activeNetwork)) {
                  return Promise.resolve();
                }

                return Promise.reject('');
              }
            })
          ]}
        >
          <Input placeholder="address" />
        </Form.Item>

        <Form.Item
          label="Choose asset"
          name="asset"
          hasFeedback
          rules={[
            {
              required: true,
              message: ''
            },
          ]}
        >
          <div
            onClick={() => setExpanded(!expanded)}
          >
            <span>
              {selectedAsset?.symbol || "SYS"}
              <Icon name="arrow-down" className="w-4 bg-brand-graydark100 text-brand-white" />
            </span>
            <ul >
              <li onClick={() => handleAssetSelected(1)}>
                <p>SYS</p>
                <p>Native</p>
              </li>

              {accounts.find(element => element.id === activeAccountId)!.assets.map((item, index) => {
                if (!controller.wallet.account.isNFT(item.assetGuid)) {
                  return (
                    <li key={index} onClick={() => handleAssetSelected(item.assetGuid)}>
                      <p>{item.symbol}</p>
                      <p>SPT</p>
                    </li>
                  )
                }

                return (
                  <li key={index} onClick={() => handleAssetSelected(item.assetGuid)}>
                    <p>{item.symbol}</p>
                    <p>NFT</p>
                  </li>
                )
              })}
            </ul>
          </div>
        </Form.Item>

        <Form.Item
          label="Asset amount"
          name="amount"
          hasFeedback
          rules={[
            {
              required: true,
              message: ''
            },
          ]}
        >
          <Input placeholder="amount" />
          {accounts.find(element => element.id === activeAccountId)!.balance === 0 && <small >You don't have SYS available.</small>}
          <Button
            type="button"
            onClick={() =>
              setAmount(selectedAsset ? controller.wallet.account.isNFT(selectedAsset.assetGuid) ? String(selectedAsset.balance) : String((selectedAsset.balance / 10 ** selectedAsset.decimals).toFixed(selectedAsset.decimals)) : String(accounts.find(element => element.id === activeAccountId)!.balance))
            }
          >
            Max
          </Button>
        </Form.Item>

        <Form.Item
          label="Fee"
          name="fee"
          hasFeedback
          rules={[
            {
              required: true,
              message: ''
            },
          ]}
        >
          <Input placeholder="fee" />
          <div>
            {`With current network conditions we recommend a fee of ${recommend} SYS.`}
          </div>
          <Button
            type="button"
            onClick={handleGetFee}
          >
            Recommend
          </Button>
        </Form.Item>
      </Form> */}

      {/* <form autoComplete="off">
        <section >
          <ul >
            <div >
              <span>
                ≈ {!selectedAsset ? getFiatAmount(Number(amount) + Number(fee), 6) : getFiatAmount(Number(fee), 6)}
              </span>
            </div>

            <div>
              <Button
                type="button"
              >
                Close
              </Button>

              <Button
                type="submit"
                disabled={
                  accounts.find(element => element.id === activeAccountId)!.balance === 0 ||
                  checkAssetBalance() < Number(amount) ||
                  !amount ||
                  !fee ||
                  Number(fee) > 0.1 ||
                  !address ||
                  Number(amount) <= 0
                }
              >
                Send
              </Button>
            </div>
          </ul>
        </section>
      </form> */}
    </div>
  );
};
