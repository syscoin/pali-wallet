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

const CreateAndIssueNFTConfirm = () => {
  const controller = useController();
  const history = useHistory();

  const { accounts, currentSenderURL }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );
  const [connectedAccountId, setConnectedAccountId] = useState(-1);
  const mintNFT = controller.wallet.account.getTransactionItem().mintNFT;
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
      item: mintNFT ? 'mintNFT' : null
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
    // if (mintNFT) {
    //   Object.entries(mintNFT).map(([key, value]) => {
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
  //   mintNFT
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
  //     {mintNFT && (
  //       <div>
  //         <Layout title="Create Token" showLogo>
  //           <div className={styles.wrapper}>
  //             <div>
  //               <section className={styles.data}>
  //                 <div className={styles.flex}>
  //                   <p>Precision</p>
  //                   <p>{mintNFT?.precision}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Symbol</p>
  //                   <p>{mintNFT?.symbol}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Z-DAG</p>
  //                   <p>{mintNFT?.rbf ? 'Yes' : 'No'}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Receiver</p>
  //                   <p>{ellipsis(mintNFT?.receiver)}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Fee</p>
  //                   <p>{mintNFT?.fee}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Description</p>
  //                   <p>{mintNFT?.description}</p>
  //                 </div>


  //                 <div className={styles.flex}>
  //                   <p>Site</p>
  //                   <p>{getHost(`${currentSenderURL}`)}</p>
  //                 </div>

  //                 <div className={styles.flex}>
  //                   <p>Max total</p>
  //                   <p>{mintNFT?.fee}</p>
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
  //                       {mintNFT?.capabilityflags && (
  //                         <div className={styles.flex}>
  //                           <p>Capability</p>
  //                           <p>{mintNFT?.capabilityflags}</p>
  //                         </div>
  //                       )}

  //                       {mintNFT?.notaryAddress && (
  //                         <div className={styles.flex}>
  //                           <p>Notary address</p>
  //                           <p>{ellipsis(mintNFT?.notaryAddress)}</p>
  //                         </div>
  //                       )}

  //                       {mintNFT?.payoutAddress && (
  //                         <div className={styles.flex}>
  //                           <p>Payout address</p>
  //                           <p>{ellipsis(mintNFT?.payoutAddress)}</p>
  //                         </div>
  //                       )}

  //                       {mintNFT?.notarydetails && (
  //                         <div>
  //                           <p>Notary details</p>
  //                           <div className={styles.flex}>
  //                             <p>Endpoint</p>
  //                             <p>{formatURL(mintNFT?.notarydetails.endpoint) || 'None'}</p>
  //                           </div>

  //                           <div className={styles.flex}>
  //                             <p>Instant transfers</p>
  //                             <p>{mintNFT?.notarydetails.instanttransfers || 0}</p>
  //                           </div>

  //                           <div className={styles.flex}>
  //                             <p>HD required</p>
  //                             <p>{mintNFT?.notarydetails.hdrequired ? 'Yes' : 'No'}</p>
  //                           </div>
  //                         </div>
  //                       )}

  //                       {mintNFT?.auxfeedeetails && (
  //                         <div>
  //                           <p>Aux fee details</p>
  //                           <div className={styles.flex}>
  //                             <p>Aux fee key id</p>
  //                             <p>{mintNFT?.auxfeedeetails.auxfeekeyid ? mintNFT?.auxfeedeetails.auxfeekeyid : 'None'}</p>
  //                           </div>

  //                           <div className={styles.flex}>
  //                             <p>Bound</p>
  //                             <p>{mintNFT?.auxfeedeetails.auxfees[0].bound ? mintNFT?.auxfeedeetails.auxfees[0].bound : 0}</p>
  //                           </div>

  //                           <div className={styles.flex}>
  //                             <p>Percent</p>
  //                             <p>{mintNFT?.auxfeedeetails.auxfees[0].percent ? mintNFT?.auxfeedeetails.auxfees[0].percent : 0}</p>
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
        transactionItem="mintNFT"
        itemStringToClearData="mintNFT"
        confirmTransaction={controller.wallet.account.confirmIssueNFT}
        errorMessage="Can\'t create and issue NFT. Try again later."
        layoutTitle="Confirm NFT creation"
        // data={dataToRender}
        data={mintNFT}
      />
    </div>
  )
};

export default CreateAndIssueNFTConfirm;
