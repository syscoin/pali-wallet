import * as React from 'react';
import {
  // ChangeEvent,
  useState,
  useCallback,
  useMemo,
  useEffect,
  FC,
} from 'react';
import * as yup from 'yup';
import { useHistory } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useSelector } from 'react-redux';
import { useAlert } from 'react-alert';
import Header from 'containers/common/Header';
import Button from 'components/Button';
import Switch from "react-switch";
import TextInput from 'components/TextInput';
import VerifiedIcon from 'assets/images/svg/check-green.svg';
import Close from 'assets/images/svg/cancel.svg';
import { useController } from 'hooks/index';
import { useFiat } from 'hooks/usePrice';
import IWalletState from 'state/wallet/types';
import { RootState } from 'state/store';
import ReactTooltip from 'react-tooltip';
import HelpOutlineIcon from '@material-ui/icons/HelpOutline';
import DownArrowIcon from '@material-ui/icons/ExpandMore';
import Spinner from '@material-ui/core/CircularProgress';
import { Assets } from '../../../scripts/types';

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
  const { accounts, activeAccountId, activeNetwork, changingNetwork }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const [address, setAddress] = useState<string>(initAddress);
  const [amount, setAmount] = useState<string>('');
  const [fee, setFee] = useState<string>('0.00001');
  const [recommend, setRecommend] = useState<number>(0);
  const [checked, setChecked] = useState<boolean>(false);
  const [selectedAsset, setSelectedAsset] = useState<Assets | null>(null);
  const [expanded, setExpanded] = useState<boolean>(false);

  const isValidAddress = useMemo(() => {
    return controller.wallet.account.isValidSYSAddress(address, activeNetwork);
  }, [address]);

  // const addressInputClass = clsx(styles.input, styles.address, {
  //   [styles.verified]: isValidAddress || (address && !isValidAddress),
  // });

  // const statusIconClass = clsx(styles.statusIcon, {
  //   [styles.hide]: !isValidAddress,
  // });

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

    if (Number(fee) > 0.1) {
      alert.removeAll();
      alert.error(`Error: Fee too high, maximum 0.1 SYS`, { timeout: 2000 });

      return;
    }

    if (selectedAsset) {
      try {
        controller.wallet.account.updateTempTx({
          fromAddress: accounts.find(element => element.id === activeAccountId)!.address.main,
          toAddress: address,
          amount,
          fee,
          token: selectedAsset.assetGuid,
          isToken: true,
          rbf: !checked,
        });

        history.push('/send/confirm');
      } catch (error) {
        alert.removeAll();
        alert.error('An internal error has occurred.');
      }

      return;
    }
    
    controller.wallet.account.updateTempTx({
      fromAddress: accounts.find(element => element.id === activeAccountId)!.address.main,
      toAddress: address,
      amount,
      fee,
      token: null,
      isToken: false,
      rbf: true,
    });

    history.push('/send/confirm');
  };

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

  const handleTypeChanged = useCallback(
    (
      checked: boolean
    ) => {
      setChecked(checked);
    },
    []
  )

  const handleGetFee = () => {
    controller.wallet.account.getRecommendFee().then((response: any) => {
      setRecommend(response);
      setFee(response.toString());
    });
  };

  const handleAssetSelected = (item: any) => {
    const selectedAsset = accounts.find(element => element.id === activeAccountId)!.assets.filter((asset: Assets) => asset.assetGuid == item);

    if (selectedAsset[0]) {
      setSelectedAsset(selectedAsset[0]);

      return;
    }

    setSelectedAsset(null);
  };

  useEffect(handleGetFee, []);

  // const checkAssetBalance = () => {
  //   return Number(selectedAsset ?
  //     (selectedAsset.balance / 10 ** selectedAsset.decimals).toFixed(selectedAsset.decimals) :
  //     accounts.find(element => element.id === activeAccountId)!.balance.toFixed(8))
  // }

  const showAssetBalance = () => {
    return (selectedAsset ?
      (selectedAsset.balance / 10 ** selectedAsset.decimals).toFixed(selectedAsset.decimals) :
      accounts.find(element => element.id === activeAccountId)!.balance.toFixed(8))
  }

  return (
    <div>
      <Header />

      <form onSubmit={handleSubmit(onSubmit)} autoComplete="off">
        <section>Send {selectedAsset ? selectedAsset.symbol : "SYS"}</section>
        <section>
          <div>
            Balance:{' '}
            {changingNetwork ? (
              <Spinner size={20}  />
            ) : (
              <span>{showAssetBalance()}</span>
            )}

            {selectedAsset
              ? selectedAsset.symbol
              : <small>{activeNetwork == "testnet" ? "TSYS" : "SYS"}</small>}
          </div>
        </section>

        <section >
          <ul >
            <li >
              <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label htmlFor="address">Recipient Address</label>
              </div>

              <img
                src={VerifiedIcon}
                alt="checked"
              />

              <img
                src={Close}
                alt="checked"
                onClick={() => setAddress("")}
              />

              <TextInput
                placeholder="Enter a valid address"
                inputRef={register}
              />
            </li>

            <div >
              <li>
                <div
                  id="asset"
                >
                  <label
                    htmlFor="asset"
                  >
                    Choose Asset
                  </label>
                  <div
                    onClick={() => setExpanded(!expanded)}
                  >
                    <span>
                      {selectedAsset?.symbol || "SYS"}
                      <DownArrowIcon />
                    </span>
                    <ul >
                      <li  onClick={() => handleAssetSelected(1)}>
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
                </div>
              </li>

              <li>
                <div>
                  <label htmlFor="rbf">Z-DAG</label>

                  <div >
                    <HelpOutlineIcon
                      style={{ width: '17px', height: '17px' }}
                      data-tip
                      data-for="zdag_info"
                    />
                    <ReactTooltip id="zdag_info"
                      getContent={() =>
                        <div style={{ backgroundColor: 'white' }}>
                          <small style={{ fontWeight: 'bold' }}>
                            OFF for Replace-by-fee (RBF) and ON for Z-DAG <br />
                            Z-DAG: a exclusive Syscoin feature.<br />
                            Z-DAG enable faster transactions but should not be used for high amounts
                            <br />
                            <strong>To know more:</strong>
                            <span
                              style={{ cursor: 'pointer' }}
                              onClick={() => {
                                window.open("https://syscoin.org/news/what-is-z-dag");
                              }}
                            >
                              <a href=""> What is Z-DAG?</a>
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
                      place="top"
                      border
                      type="info"
                      multiline
                    />
                  </div>
                </div>

                <Switch
                  disabled={!selectedAsset}
                  offColor="#333f52"
                  height={20}
                  width={60}
                  checked={checked}
                  onChange={handleTypeChanged}
                />
              </li>
            </div>

            <div>
              <li>
                <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="amount"> {selectedAsset ? selectedAsset.symbol : "SYS"} Amount</label>

                  {accounts.find(element => element.id === activeAccountId)!.balance === 0 && <small >You don't have SYS available.</small>}
                </div>

                <TextInput
                  placeholder="Enter amount to send"
                  inputRef={register}
                />

                <Button
                  type="button"
                  onClick={() =>
                    setAmount(selectedAsset ? controller.wallet.account.isNFT(selectedAsset.assetGuid) ? String(selectedAsset.balance) : String((selectedAsset.balance / 10 ** selectedAsset.decimals).toFixed(selectedAsset.decimals)) : String(accounts.find(element => element.id === activeAccountId)!.balance))
                  }
                >
                  Max
                </Button>
              </li>

              <li >
                <label
                  htmlFor="fee"
                  style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  Transaction Fee
                </label>

                <TextInput
                  placeholder="Enter transaction fee"
                  inputRef={register}
                />

                <Button
                  type="button"
                  onClick={handleGetFee}
                >
                  Recommend
                </Button>
              </li>
            </div>

            <div>
              {`With current network conditions we recommend a fee of ${recommend} SYS.`}
            </div>

            <div >
              <span>
                ≈ {!selectedAsset ? getFiatAmount(Number(amount) + Number(fee), 6) : getFiatAmount(Number(fee), 6)}

              </span>
              {!!Object.values(errors).length && (
                <span >
                  {Object.values(errors)[0].message}
                </span>
              )}
            </div>

            <div>
              <Button
                type="button"
                linkTo="/home"
              >
                Close
              </Button>

              <Button
                type="submit"
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
