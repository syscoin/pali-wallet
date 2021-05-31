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
  const { accounts, activeAccountId, activeNetwork }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const [address, setAddress] = useState<string>(initAddress);
  const [amount, setAmount] = useState<string>('');
  const [fee, setFee] = useState<string>('0');
  const [recommend, setRecommend] = useState<number>(0);
  const [checked, setChecked] = useState<boolean>(false);
  const [selectedAsset, setSelectedAsset] = useState<Assets | null>(null);

  const isValidAddress = useMemo(() => {
    return controller.wallet.account.isValidSYSAddress(address, activeNetwork);
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

    const {
      address,
      amount,
      fee
    } = data;

    if (accounts[activeAccountId].address.main === address) {
      alert.removeAll();
      alert.error('Error: cannot complete transaction. Check the recipient\'s address.');
    }

    if (selectedAsset) {
      try {
        controller.wallet.account.updateTempTx({
          fromAddress: accounts[activeAccountId].address.main,
          toAddress: address,
          amount,
          fee,
          token: selectedAsset,
          isToken: true,
          rbf: !checked,
        });
  
        history.push('/send/confirm');
      } catch (error) {
        console.log(error);
        alert.removeAll();
        alert.error('An internal error has occurred.');
      }

      return;
    }
    
    controller.wallet.account.updateTempTx({
      fromAddress: accounts[activeAccountId].address.main,
      toAddress: address,
      amount,
      fee,
      token: null,
      isToken: false,
      rbf: !checked,
    });  

    history.push('/send/confirm');
  };

  const handleAmountChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setAmount(event.target.value);
    },
    []
  );

  const handleFeeChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFee(event.target.value);
    },
    []
  );

  const handleAddressChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setAddress(event.target.value.trim());
    },
    []
  );

  const handleTypeChanged = useCallback(
    (
      checked: boolean
    ) => {
      setChecked(checked);
    },
    []
  )

  const handleGetFee = () => {
    controller.wallet.account.getRecommendFee().then(response => {
      setRecommend(response);
      setFee(response.toString());
    });
  };

  const handleAssetSelected = (event: ChangeEvent<{
    name?: string | undefined;
    value: unknown;
  }>
  ) => {
    let selectedAsset = accounts[activeAccountId].assets.filter((asset: Assets) => asset.assetGuid == event.target.value);

    if (selectedAsset[0]) {
      setSelectedAsset(selectedAsset[0]);

      return;
    }
    
    setSelectedAsset(null);
  };

  useEffect(handleGetFee, []);

  return (
    <div className={styles.wrapper}>
      <Header backLink="/home" />

      <form onSubmit={handleSubmit(onSubmit)}>
        <section className={styles.subheading}>Send {selectedAsset ? selectedAsset.symbol : "SYS"}</section>
        <section className={styles.balance}>
          <div>
            Balance:{' '}
            <span>{selectedAsset ?
              controller.wallet.account.isNFT(selectedAsset.assetGuid) ?
              selectedAsset.balance :
              (selectedAsset.balance / 10 ** selectedAsset.decimals).toFixed(selectedAsset.decimals) :
              accounts[activeAccountId].balance}
            </span> 
            
            {selectedAsset ? selectedAsset.symbol : "SYS"}
          </div>

        </section>

        {/* {accounts[activeAccountId].balance === 0 && <small>You don't have SYS available.</small>} */}
        
        <section className={styles.content}>
          <ul className={styles.form}>
            <li>
              <label htmlFor="address">Recipient Address</label>

              <img
                src={VerifiedIcon}
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

            <div className={styles.formBlock}>
              <li>
                <label htmlFor="asset">Choose Asset</label>

                <div
                  className={styles.select}
                  id="asset"
                >
                  <MUISelect
                    native
                    defaultValue="SYS"
                    input={<Input id="grouped-native-select" />}
                    onChange={handleAssetSelected}
                  >
                    <optgroup label="Native">
                      <option value={1}>SYS</option>
                    </optgroup>

                    <optgroup label="SPT">
                      {accounts[activeAccountId].assets.map((asset: Assets, idx: number) => {
                        if (!controller.wallet.account.isNFT(asset.assetGuid)) {
                          return <option key={idx} value={asset.assetGuid}>{asset.symbol}</option>
                        }
                        return
                      })
                      }
                    </optgroup>

                    <optgroup label="NFT">
                      {accounts[activeAccountId].assets.map((asset: Assets, idx: number) => {
                        if (controller.wallet.account.isNFT(asset.assetGuid)) {
                          return <option key={idx} value={asset.assetGuid}>{asset.symbol}</option>
                        }
                        return
                      })
                      }
                    </optgroup>
                  </MUISelect>
                </div>
              </li>

              <li>
                <div className={styles.zDag}>
                  <label htmlFor="rbf">Z-DAG</label>

                  <div className={styles.tooltip}>
                    <HelpOutlineIcon
                      style={{ width: '17px', height: '17px' }}
                      data-tip
                      data-for="zdag_info"
                    />
                    <ReactTooltip id="zdag_info"
                        getContent={() =>
                          <div style={{ backgroundColor: 'white' }}>
                            <small style={{ fontWeight: 'bold' }}>
                              OFF for Replace-by-fee (RBF) and ON for Z-DAG <br/> Z-DAG: a exclusive Syscoin feature. <br/> To know more: <br/>
                              <span
                                style={{ cursor: 'pointer' }}
                                onClick={() => {
                                  window.open("https://syscoin.org/news/what-is-z-dag");
                                }}
                              >
                                What is Z-DAG?
                              </span>
                            </small>
                          </div>
                        }
                        backgroundColor="white"
                        textColor="black"
                        borderColor="#4d76b8"
                        effect='solid'
                        delayHide={300}
                        delayShow={300}
                        delayUpdate={300}
                        place={'top'}
                        border={true}
                        type={'info'}
                        multiline={true}
                      />
                  </div>
                </div>
                
                <Switch
                  height={20}
                  width={60}
                  checked={checked}
                  onChange={handleTypeChanged}
                ></Switch>
              </li>
            </div>

            <div>
              <li>
                <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="amount"> {selectedAsset ? selectedAsset.symbol : "SYS"} Amount</label>

                  {accounts[activeAccountId].balance === 0 && <small className={styles.description} style={{ textAlign: 'left' }}>You don't have SYS available.</small>}
                </div>

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
                <label htmlFor="fee">Transaction Fee</label>
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
            </div>

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
                  accounts[activeAccountId].address.main === address ||
                  accounts[activeAccountId].balance === 0 ||
                  accounts[activeAccountId].balance < Number(amount) ||
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
          </ul>


        </section>
      </form>
    </div>
  );
};

export default WalletSend;
