import * as React from 'react';
import {
  ChangeEvent,
  useState,
  useCallback,
  useMemo,
  useEffect,
  FC,
} from 'react';
import clsx from 'clsx';
import * as yup from 'yup';
import { useHistory } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useSelector } from 'react-redux';
import { useAlert } from 'react-alert';
import { Assets } from '../../../scripts/types';
import Header from 'containers/common/Header';
import Contacts from '../Contacts';
import Button from 'components/Button';
import Switch from "react-switch";
import MUISelect from '@material-ui/core/Select';
import Input from '@material-ui/core/Input';
import TextInput from 'components/TextInput';
import VerifiedIcon from 'assets/images/svg/check-green.svg';
import { useController } from 'hooks/index';
import { useFiat } from 'hooks/usePrice';
import IWalletState from 'state/wallet/types';
import { RootState } from 'state/store';
import { formatNumber } from '../helpers';
import ReactTooltip from 'react-tooltip';
import HelpOutlineIcon from '@material-ui/icons/HelpOutline';

import styles from './Send.scss';
interface IWalletSend {
  initAddress?: string;
}
const WalletSend: FC<IWalletSend> = ({ initAddress = '' }) => {
  const { handleSubmit, register, errors } = useForm({
    validationSchema: yup.object().shape({
      address: yup.string().required('Error: Invalid SYS address'),
      amount: yup.number().moreThan(0).required('Error: Invalid SYS Amount'),
      fee: yup.number().required('Error: Invalid transaction fee')
    }),
  });
  const history = useHistory();
  const getFiatAmount = useFiat();
  const controller = useController();
  const alert = useAlert();
  const { accounts, activeAccountId }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  const [address, setAddress] = useState(initAddress);
  const [amount, setAmount] = useState('');
  const [fee, setFee] = useState('0');
  const [recommend, setRecommend] = useState(0);
  const [modalOpened, setModalOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [selectedAsset,setSelectedAsset] = useState<Assets | null>(null);

  const isValidAddress = useMemo(() => {
    return controller.wallet.account.isValidSYSAddress(address);
  }, [address]);

  const addressInputClass = clsx(styles.input, styles.address, {
    [styles.verified]: isValidAddress,
  });
  const statusIconClass = clsx(styles.statusIcon, {
    [styles.hide]: !isValidAddress,
  });

  const onSubmit = (data: any) => {
    if (!isValidAddress) {
      alert.removeAll();
      alert.error('Error: Invalid recipient address');
      return;
    }
    console.log("Checking form data "+ data)
    if (selectedAsset) {
      controller.wallet.account.updateTempTx({
        fromAddress: accounts[activeAccountId].address.main,
        toAddress: data.address,
        amount: data.amount,
        fee: data.fee,
        token: selectedAsset,
        isToken: true,
        rbf: !checked,
      });
    }
    else {
      controller.wallet.account.updateTempTx({
        fromAddress: accounts[activeAccountId].address.main,
        toAddress: data.address,
        amount: data.amount,
        fee: data.fee,
        token: null,
        isToken: false,
        rbf: !checked,
      });
    }
    history.push('/send/confirm');
  };

  const handleAmountChange = useCallback(
    (ev: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setAmount(ev.target.value);
    },
    []
  );

  const handleFeeChange = useCallback(
    (ev: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFee(ev.target.value);
    },
    []
  );

  const handleAddressChange = useCallback(
    (ev: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setAddress(ev.target.value.trim());
    },
    []
  );

  const handleTypeChanged = useCallback(
    ( 
      checked: boolean
  ) => {
      console.log("Checking checked" + checked)
      setChecked(checked)
    },
    []
  )

  const handleGetFee = () => {
    controller.wallet.account.getRecommendFee().then(response => { setRecommend(response); setFee(response.toString()); })
    // setRecommend(controller.wallet.account.getRecommendFee());
    // setFee((controller.wallet.account.getRecommendFee()).toString());
  };

  const handleAssetSelected = (ev: ChangeEvent<{
    name?: string | undefined;
    value: unknown;
  }>
  ) => {
    console.log("The asset" + ev.target.name + "value" + ev.target.value)
    let selectedAsset = accounts[activeAccountId].assets.filter((asset: Assets) => asset.assetGuid == ev.target.value)
    if (selectedAsset[0]) {
      setSelectedAsset(selectedAsset[0])
    }
    else {
      setSelectedAsset(null)
    }
  };

  useEffect(handleGetFee, []);
  // const isNFT = (guid: Number) => {
  //   let assetGuid = BigInt.asUintN(64, BigInt(guid))
  //   return (assetGuid >> BigInt(32)) > 0
  // }

  return (
    <div className={styles.wrapper}>
      <Header backLink="/home" />

      <form onSubmit={handleSubmit(onSubmit)}>
        <section className={styles.subheading}>Send {selectedAsset ? selectedAsset.symbol : "SYS"}</section>
        <section className={styles.balance}>
          <div>
            Balance:{' '}
            <span>{selectedAsset ? controller.wallet.account.isNFT(selectedAsset.assetGuid) ? selectedAsset.balance : (selectedAsset.balance / 10 ** selectedAsset.decimals).toFixed(selectedAsset.decimals) : accounts[activeAccountId].balance}</span> {selectedAsset ? selectedAsset.symbol : "SYS"}
          </div>
        </section>

        <section className={styles.content}>
          <ul className={styles.form}>
            <li>
              <label>Recipient Address</label>
              <img
                src={`/${VerifiedIcon}`}
                alt="checked"
                className={statusIconClass}
              />
              <TextInput
                placeholder="Enter a valid address"
                fullWidth
                value={address}
                name="address"
                inputRef={register}
                onChange={handleAddressChange}
                variant={addressInputClass}
              />
            </li>

            <li>
              
              <label>Choose Asset</label>
              <div style={{ display: "flex", justifyContent: "space-between", width: "100%"}}>
                      
                <div className={styles.select}>
                  <MUISelect native defaultValue="SYS" 
                  input={<Input id="grouped-native-select"  />}
                  onChange={handleAssetSelected}
                  >
                  <optgroup label="Native">
                    <option value={1}>SYS</option>
                  </optgroup>

                  <optgroup label="SPT">
                    {accounts[activeAccountId].assets.map((asset: Assets, idx: number) => {
                      if(!controller.wallet.account.isNFT(asset.assetGuid)){
                      return <option key={idx} value={asset.assetGuid}>{asset.symbol}</option>
                      }
                      return
                    })
                  }
                  </optgroup>

                  <optgroup label="NFT">
                    {accounts[activeAccountId].assets.map((asset: Assets, idx: number) => {
                        if(controller.wallet.account.isNFT(asset.assetGuid)){
                        return <option key={idx} value={asset.assetGuid}>{asset.symbol}</option>
                        }
                        return
                      })
                    }
                  </optgroup>

                  </MUISelect>
                
              </div>

              <div>
                <span>
                  <label>Z-DAG</label>
                  <HelpOutlineIcon
                      data-tip data-for="zdag_info"
                      />
                  
                  <ReactTooltip id="zdag_info"
                  getContent={()=>
                    <ul>
                      <li>Button:</li>
                      <li>
                        <span>
                          OFF for Replace-by-fee(RBF) 
                          ON for Z-DAG
                        </span>
                      </li>

                      <li>
                        <span>
                        Z-DAG, a exclusive syscoin feature,<br/>
                        is a blockchain scalability sulution
                        </span>
                      </li>

                      <li>
                        to know more: <br/>
                        <span onClick={() => {window.open("https://syscoin.org/news/what-is-z-dag");}}>
                          what is Z-DAG?
                        </span>
                      </li>
                    </ul>
                  }
                  effect='solid'
                  delayHide={1500}
                  delayShow={500}
                  delayUpdate={500}
                  place={'left'}
                  border={true}
                  type={'info'}
                  />
                </span>
              </div>

                  <Switch 
                  checked={checked}
                  onChange={handleTypeChanged}
                ></Switch>

              </div>
            </li>

            <li>
              <label> {selectedAsset ? selectedAsset.symbol : "SYS"} Amount</label>
              <TextInput
                type="number"
                placeholder="Enter amount to send"
                fullWidth
                inputRef={register}
                name="amount"
                value={amount}
                onChange={handleAmountChange}
                variant={clsx(styles.input, styles.amount)}
              />
              <Button
                type="button"
                variant={styles.textBtn}
                onClick={() =>
                  setAmount(selectedAsset ? controller.wallet.account.isNFT(selectedAsset.assetGuid) ? String(selectedAsset.balance) : String((selectedAsset.balance / 10 ** selectedAsset.decimals).toFixed(selectedAsset.decimals)) : String(accounts[activeAccountId].balance))
                }
              >
                Max
              </Button>
            </li>
            
            <li>
              <label>Transaction Fee</label>
              <TextInput
                type="number"
                placeholder="Enter transaction fee"
                fullWidth
                inputRef={register}
                name="fee"
                onChange={handleFeeChange}
                value={fee}
                variant={clsx(styles.input, styles.fee)}
              />
              <Button
                type="button"
                variant={styles.textBtn}
                onClick={handleGetFee}
              >
                Recommend
              </Button>
            </li>
          </ul>

          <div className={styles.description}>
            {`With current network conditions we recommend a fee of ${recommend} SYS.`}
          </div>
          
          <div className={styles.status}>
            <span className={styles.equalAmount}>
              ≈ {getFiatAmount(Number(amount) + Number(fee), 6)}
            </span>
            {!!Object.values(errors).length && (
              <span className={styles.error}>
                {Object.values(errors)[0].message}
              </span>
            )}
          </div>

          <div className={styles.actions}>
            <Button
              type="button"
              theme="btn-outline-secondary"
              variant={clsx(styles.button, styles.close)}
              linkTo="/home"
            >
              Close
            </Button>
            
            <Button
              type="submit"
              theme="btn-outline-primary"
              variant={styles.button}
              disabled={
                !isValidAddress ||
                !amount ||
                !fee ||
                !address ||
                Number(amount) <= 0
              }
            >
              Send
            </Button>
          </div>
        </section>
      </form>
    </div>
  );
};

export default WalletSend;
