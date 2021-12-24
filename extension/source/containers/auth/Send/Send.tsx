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
import { IconButton, Icon } from 'components/index';
import { useUtils } from 'hooks/index';

// import { Assets } from 'scripts/types';
// import { Form, Input } from 'antd';

interface ISend {
  initAddress?: string;
}
export const Send: FC<ISend> = (/* { initAddress = '' } */) => {
  // // const getFiatAmount = useFiat();
  // const controller = useController();
  const { history } = useUtils();
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
    <div>
      <Header normalHeader />

      <div>
        <IconButton
          type="primary"
          shape="circle"
          onClick={() => history.goBack()}
        >
          <Icon
            name="arrow-left"
            className="w-4 bg-brand-graydark100 text-brand-white"
          />
        </IconButton>
      </div>

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

        <section className={styles.content}>
          <ul className={styles.form}>
            <li className={styles.item}>
              <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <label htmlFor="address">Recipient Address</label>
                </div>

                <div style={{ columnGap: '3px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="address">Verify address</label>

                  <HelpOutlineIcon
                    style={{ width: '17px', height: '17px' }}
                    data-tip
                    data-for="address_info"
                  />
                </div>
              </div>

              <img
                src={VerifiedIcon}
                alt="checked"
                className={statusIconClass}
              />

              <img
                src={Close}
                alt="checked"
                onClick={() => setAddress("")}
                className={address && !isValidAddress ? styles.statusIsNotValidClass : styles.hideCloseIcon}
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

              <li className={styles.item}>
                <div className={styles.textBtn} style={{ top: '-49px' }}>
                  <div >
                    <div className={styles.tooltip}>
                      <ReactTooltip id="address_info"
                        getContent={() =>
                          <div style={{ backgroundColor: 'white' }}>
                            <small style={{ fontWeight: 'bold' }}>
                              ON for enable verification (recommended): Pali verify that is a valid SYS address <br />
                              OFF for disable address verification: only disable this verification if you are <br /> fully aware of what you are doing and if you trust the recipient address you want to send for.<br />
                              <br />
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
                    offColor="#1b2e4d"
                    height={20}
                    width={60}
                    checked={verification}
                    onChange={handleAddressTypeChanged}
                  />
                </div>

              </li>
            </li>

            <div className={!selectedAsset ? styles.formBlockOne : styles.formBlock}>
              <li className={!selectedAsset ? styles.noAssetItem : styles.item}>
                <div
                  className={styles.select}
                  id="asset"
                >
                  <label
                    htmlFor="asset"
                    style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                  >
                    Choose Asset
                  </label>
                  <div
                    className={clsx(styles.fullselect, { [styles.expanded]: expanded })}
                    onClick={() => setExpanded(!expanded)}
                  >
                    <span className={styles.selected}>
                      {selectedAsset?.symbol || "SYS"}
                      <DownArrowIcon className={styles.arrow} />
                    </span>
                    <ul className={styles.options}>
                      <li className={styles.option} onClick={() => handleAssetSelected(1)}>
                        <p>SYS</p>
                        <p>Native</p>
                      </li>

                      {accounts.find(element => element.id === activeAccountId)!.assets.map((item, index) => {
                        if (!controller.wallet.account.isNFT(item.assetGuid)) {
                          return (
                            <li className={styles.option} key={index} onClick={() => handleAssetSelected(item.assetGuid)}>
                              <p>{item.symbol}</p>
                              <p>SPT</p>
                            </li>
                          )
                        }

                        return (
                          <li className={styles.option} key={index} onClick={() => handleAssetSelected(item.assetGuid)}>
                            <p>{item.symbol}</p>
                            <p>NFT</p>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                </div>
              </li>

              <li className={!selectedAsset ? styles.noAsset : styles.item}>
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
              <li className={styles.item}>
                <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="amount"> {selectedAsset ? selectedAsset.symbol : "SYS"} Amount</label>

                  {accounts.find(element => element.id === activeAccountId)!.balance === 0 && <small className={styles.description} style={{ textAlign: 'left' }}>You don't have SYS available.</small>}
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
                    setAmount(selectedAsset ? controller.wallet.account.isNFT(selectedAsset.assetGuid) ? String(selectedAsset.balance) : String((selectedAsset.balance / 10 ** selectedAsset.decimals).toFixed(selectedAsset.decimals)) : String(accounts.find(element => element.id === activeAccountId)!.balance))
                  }
                >
                  Max
                </Button>
              </li>

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
