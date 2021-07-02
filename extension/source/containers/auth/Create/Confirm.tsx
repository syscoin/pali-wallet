import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { useSelector } from 'react-redux';

// import Header from 'containers/common/Header';
import Layout from 'containers/common/Layout';
import Button from 'components/Button';
import { useController } from 'hooks/index';
import { RootState } from 'state/store';
import { ellipsis, formatURL } from '../helpers';
import IWalletState, { IAccountState } from 'state/wallet/types';
import { useAlert } from 'react-alert';

import styles from './Create.scss';
import { browser } from 'webextension-polyfill-ts';
import { getHost } from '../../../scripts/Background/helpers';
import DownArrowIcon from '@material-ui/icons/ExpandMore';
import Spinner from '@material-ui/core/CircularProgress';
import { useHistory } from 'react-router';
import { ConfirmTransaction } from '../SiteTransaction';

const CreateTokenConfirm = () => {
  const controller = useController();
  const history = useHistory();

  const { accounts, currentSenderURL, creatingAsset }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const [connectedAccountId, setConnectedAccountId] = useState(-1);
  const newSPT = controller.wallet.account.getTransactionItem().newSPT;
  const [confirmed, setConfirmed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [loadingConfirm, setLoadingConfirm] = useState<boolean>(false);
  const [dataToRender, setDataToRender] = useState<Array<any>>([]);
  const alert = useAlert();

  useEffect(() => {
    setConnectedAccountId(accounts.findIndex((account: IAccountState) => {
      return account.connectedTo.filter((url: string) => {
        return url === getHost(currentSenderURL);
      })
    }))
  }, []);

  const handleClosePopup = () => {
    history.push('/home');

    browser.runtime.sendMessage({
      type: "CLOSE_POPUP",
      target: "background"
    });
  }

  const handleCancelTransactionOnSite = () => {
    history.push('/home');

    browser.runtime.sendMessage({
      type: "CANCEL_TRANSACTION",
      target: "background",
      item: newSPT ? 'newSPT' : null
    });

    browser.runtime.sendMessage({
      type: "CLOSE_POPUP",
      target: "background"
    });
  }

  const handleConfirm = () => {
    let acc = accounts.find(element => element.id === connectedAccountId)
    let isPending = false;

    if ((acc ? acc.balance : -1) > 0) {
      setLoadingConfirm(true);
      isPending = true;

      controller.wallet.account.confirmNewSPT().then((error: any) => {
        if (error) {
          console.log('error', error)
          alert.removeAll();
          alert.error('Can\'t create token. Try again later.');

          browser.runtime.sendMessage({
            type: 'WALLET_ERROR',
            target: 'background',
            transactionError: true,
            invalidParams: false,
            message: "Can't create token. Try again later"
          });

          setTimeout(() => {
            handleCancelTransactionOnSite();
          }, 4000);

          return;
        }

        isPending = false;

        setConfirmed(true);
        setLoading(false);
        setLoadingConfirm(false);
      });

      setTimeout(() => {
        if (isPending && !confirmed) {
          alert.removeAll();
          alert.error('Can\'t create token. Please, try again later.');

          setTimeout(() => {
            handleCancelTransactionOnSite();
          }, 4000);
        }
      }, 90000);
    }
  }
  
  // useEffect(() => {
    // console.log('dat to render useeffect', dataToRender)
    // if (newSPT) {
    //   Object.entries(newSPT).map(([key, value]) => {
    //     console.log('key', key, 'value', value)
    //     console.log('data to render before', dataToRender)
        
    //     if (!dataToRender.includes({ label: key, value })) {
    //       setDataToRender([
    //         ...dataToRender,
    //         dataToRender.push({
    //           label: key,
    //           value
    //         }),
    //       ]);
    //     }
        
    //     for (let item of dataToRender) {
    //       console.log('item from data to render', item)
    //     }
        
    //     console.log('data to render after', dataToRender)
        
    //     return;
        
        
        
    //   });
      
//       uxfeedetails: undefined
// capabilityflags: 127
// description: "new description to test 9"
// fee: 0.00001
// maxsupply: 10
// notaryAddress: undefined
// notarydetails: undefined
// payoutAddress: undefined
// precision: 8
// rbf: false
// receiver: "tsys1qrmf32mnr9k6kar76nee2hrgc5znnj8slq4n9ju"
// symbol: "banana"

      
  //   }
  // }, [
  //   newSPT
  // ]);

  // return confirmed ? (
  //   <Layout title="Your transaction is underway" linkTo="/remind" showLogo>
  //     <div className="body-description">
  //       You can follow your transaction under activity on your account screen.
  //     </div>
  //     <Button
  //       type="button"
  //       theme="btn-gradient-primary"
  //       variant={styles.next}
  //       linkTo="/home"
  //       onClick={handleClosePopup}
  //     >
  //       Ok
  //     </Button>
  //   </Layout>
  // ) : (
  //   <div>
  //     {newSPT && (
  //       <div>
  //         <Layout title="Create Token" showLogo>
  //           <div className={styles.wrapper}>
  //             <div>
  //               <section className={styles.data}>
  //                 <div className={styles.flex}>
  //                   <p>Precision</p>
  //                   <p>{newSPT?.precision}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Symbol</p>
  //                   <p>{newSPT?.symbol}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Z-DAG</p>
  //                   <p>{newSPT?.rbf ? 'Yes' : 'No'}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Receiver</p>
  //                   <p>{ellipsis(newSPT?.receiver)}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Fee</p>
  //                   <p>{newSPT?.fee}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Description</p>
  //                   <p>{newSPT?.description}</p>
  //                 </div>


  //                 <div className={styles.flex}>
  //                   <p>Site</p>
  //                   <p>{getHost(`${currentSenderURL}`)}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Max total</p>
  //                   <p>{newSPT?.fee}</p>
  //                 </div>

  //                 <div
  //                   className={styles.select}
  //                   id="asset"
  //                 >
  //                   <div
  //                     className={clsx(styles.fullselect, { [styles.expanded]: expanded })}
  //                     onClick={() => setExpanded(!expanded)}
  //                   >
  //                     <span className={styles.selected}>
  //                       Advanced options
  //                     <DownArrowIcon className={styles.arrow} />
  //                     </span>

  //                     <ul className={styles.options}>
  //                       {newSPT?.capabilityflags && (
  //                         <div className={styles.flex}>
  //                           <p>Capability</p>
  //                           <p>{newSPT?.capabilityflags}</p>
  //                         </div>
  //                       )}

  //                       {newSPT?.notaryAddress && (
  //                         <div className={styles.flex}>
  //                           <p>Notary address</p>
  //                           <p>{ellipsis(newSPT?.notaryAddress)}</p>
  //                         </div>
  //                       )}

  //                       {newSPT?.payoutAddress && (
  //                         <div className={styles.flex}>
  //                           <p>Payout address</p>
  //                           <p>{ellipsis(newSPT?.payoutAddress)}</p>
  //                         </div>
  //                       )}

  //                       {newSPT?.notarydetails && (
  //                         <div>
  //                           <p>Notary details</p>
  //                           <div className={styles.flex}>
  //                             <p>Endpoint</p>
  //                             <p>{formatURL(newSPT?.notarydetails.endpoint) || 'None'}</p>
  //                           </div>

  //                           <div className={styles.flex}>
  //                             <p>Instant transfers</p>
  //                             <p>{newSPT?.notarydetails.instanttransfers || 0}</p>
  //                           </div>

  //                           <div className={styles.flex}>
  //                             <p>HD required</p>
  //                             <p>{newSPT?.notarydetails.hdrequired ? 'Yes' : 'No'}</p>
  //                           </div>
  //                         </div>
  //                       )}

  //                       {newSPT?.auxfeedeetails && (
  //                         <div>
  //                           <p>Aux fee details</p>
  //                           <div className={styles.flex}>
  //                             <p>Aux fee key id</p>
  //                             <p>{newSPT?.auxfeedeetails.auxfeekeyid ? newSPT?.auxfeedeetails.auxfeekeyid : 'None'}</p>
  //                           </div>

  //                           <div className={styles.flex}>
  //                             <p>Bound</p>
  //                             <p>{newSPT?.auxfeedeetails.auxfees[0].bound ? newSPT?.auxfeedeetails.auxfees[0].bound : 0}</p>
  //                           </div>

  //                           <div className={styles.flex}>
  //                             <p>Percent</p>
  //                             <p>{newSPT?.auxfeedeetails.auxfees[0].percent ? newSPT?.auxfeedeetails.auxfees[0].percent : 0}</p>
  //                           </div>
  //                         </div>
  //                       )}
  //                     </ul>
  //                   </div>
  //                 </div>
  //               </section>

  //               <section className={styles.confirm}>
  //                 <div className={styles.actions}>
  //                   <Button
  //                     type="button"
  //                     theme="btn-outline-secondary"
  //                     variant={clsx(styles.button, styles.close)}
  //                     linkTo="/home"
  //                     onClick={handleCancelTransactionOnSite}
  //                   >
  //                     Reject
  //                    </Button>

  //                   <Button
  //                     type="submit"
  //                     theme="btn-outline-primary"
  //                     variant={styles.button}
  //                     onClick={handleConfirm}
  //                     loading={loading}
  //                   >
  //                     {loadingConfirm ? <Spinner size={15} className={styles.spinner} /> : 'Confirm'}
  //                   </Button>
  //                 </div>
  //               </section>
  //             </div>
  //           </div>
  //         </Layout>
  //       </div>
  //     )}
  //   </div>
  // );
  
  return (
    <div>
      <ConfirmTransaction
        transactionItem="newSPT"
        itemStringToClearData="newSPT"
        confirmTransaction={controller.wallet.account.confirmNewSPT}
        errorMessage="Can't create token. Try again later."
        layoutTitle="Confirm token creation"
        data={newSPT}
        transactingStateItem={creatingAsset}
      />
    </div>
  )
};

export default CreateTokenConfirm;
