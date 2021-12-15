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
import { Button, IconButton, Icon } from 'components/index';;
import { useController, useFiat, useStore, useUtils, useAccount } from 'hooks/index';
import { Form, Input } from 'antd';
import { AuthViewLayout } from 'containers/common/Layout';

interface ISend {
  initAddress?: string;
}
export const Send: FC<ISend> = (/*{ initAddress = '' }*/) => {
  // // const getFiatAmount = useFiat();
  // const controller = useController();
  const { alert, history } = useUtils();
  // const { accounts, activeAccountId, activeNetwork, changingNetwork } = useStore();
  const { activeAccount } = useAccount();

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
    <AuthViewLayout title="SEND SYS">
      {loaded && activeAccount ? (
        <div className="flex flex-col justify-center items-center pt-8">
          <QRCode
            value={activeAccount.address.main}
            bgColor="#fff"
            fgColor="#000"
            style={{ height: '240px', width: '225px' }}
          />

          <p className="mt-4 text-base">{ellipsis(activeAccount.address.main, 4, 10)}</p>

          <Button
            type="button"
            padding="py-1"
            classNameBorder="absolute bottom-14"
            onClick={() =>
              copyText(activeAccount.address.main)
            }
          >
            <span className="text-base">
              {isCopied ? 'Copied address' : 'Copy'}
            </span>
          </Button>
        </div>
      ) : (
        <Icon
          name="loading"
          className="w-4 text-brand-white"
        />
      )}
    </AuthViewLayout>
  );
};
