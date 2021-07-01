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

const IssueAssetConfirm = () => {
  const controller = useController();
  const history = useHistory();

  const { accounts, currentSenderURL }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const [connectedAccountId, setConnectedAccountId] = useState(-1);
  const mintSPT = controller.wallet.account.getTransactionItem().mintSPT;
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
      item: mintSPT ? 'mintSPT' : null
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

      controller.wallet.account.confirmIssueSPT().then((error: any) => {
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
    // if (mintSPT) {
    //   Object.entries(mintSPT).map(([key, value]) => {
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
  //   mintSPT
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
  //     {mintSPT && (
  //       <div>
  //         <Layout title="Create Token" showLogo>
  //           <div className={styles.wrapper}>
  //             <div>
  //               <section className={styles.data}>
  //                 <div className={styles.flex}>
  //                   <p>Precision</p>
  //                   <p>{mintSPT?.precision}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Symbol</p>
  //                   <p>{mintSPT?.symbol}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Z-DAG</p>
  //                   <p>{mintSPT?.rbf ? 'Yes' : 'No'}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Receiver</p>
  //                   <p>{ellipsis(mintSPT?.receiver)}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Fee</p>
  //                   <p>{mintSPT?.fee}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Description</p>
  //                   <p>{mintSPT?.description}</p>
  //                 </div>


  //                 <div className={styles.flex}>
  //                   <p>Site</p>
  //                   <p>{getHost(`${currentSenderURL}`)}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Max total</p>
  //                   <p>{mintSPT?.fee}</p>
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
  //                       {mintSPT?.capabilityflags && (
  //                         <div className={styles.flex}>
  //                           <p>Capability</p>
  //                           <p>{mintSPT?.capabilityflags}</p>
  //                         </div>
  //                       )}

  //                       {mintSPT?.notaryAddress && (
  //                         <div className={styles.flex}>
  //                           <p>Notary address</p>
  //                           <p>{ellipsis(mintSPT?.notaryAddress)}</p>
  //                         </div>
  //                       )}

  //                       {mintSPT?.payoutAddress && (
  //                         <div className={styles.flex}>
  //                           <p>Payout address</p>
  //                           <p>{ellipsis(mintSPT?.payoutAddress)}</p>
  //                         </div>
  //                       )}

  //                       {mintSPT?.notarydetails && (
  //                         <div>
  //                           <p>Notary details</p>
  //                           <div className={styles.flex}>
  //                             <p>Endpoint</p>
  //                             <p>{formatURL(mintSPT?.notarydetails.endpoint) || 'None'}</p>
  //                           </div>

  //                           <div className={styles.flex}>
  //                             <p>Instant transfers</p>
  //                             <p>{mintSPT?.notarydetails.instanttransfers || 0}</p>
  //                           </div>

  //                           <div className={styles.flex}>
  //                             <p>HD required</p>
  //                             <p>{mintSPT?.notarydetails.hdrequired ? 'Yes' : 'No'}</p>
  //                           </div>
  //                         </div>
  //                       )}

  //                       {mintSPT?.auxfeedeetails && (
  //                         <div>
  //                           <p>Aux fee details</p>
  //                           <div className={styles.flex}>
  //                             <p>Aux fee key id</p>
  //                             <p>{mintSPT?.auxfeedeetails.auxfeekeyid ? mintSPT?.auxfeedeetails.auxfeekeyid : 'None'}</p>
  //                           </div>

  //                           <div className={styles.flex}>
  //                             <p>Bound</p>
  //                             <p>{mintSPT?.auxfeedeetails.auxfees[0].bound ? mintSPT?.auxfeedeetails.auxfees[0].bound : 0}</p>
  //                           </div>

  //                           <div className={styles.flex}>
  //                             <p>Percent</p>
  //                             <p>{mintSPT?.auxfeedeetails.auxfees[0].percent ? mintSPT?.auxfeedeetails.auxfees[0].percent : 0}</p>
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
        transactionItem="mintSPT"
        itemStringToClearData="mintSPT"
        confirmTransaction={controller.wallet.account.confirmIssueSPT}
        errorMessage="Can\'t issue token. Try again later."
        layoutTitle="Confirm token issue"
        // data={dataToRender}
        data={mintSPT}
      />
    </div>
  )
};

export default IssueAssetConfirm;
