import React, { useState } from 'react';
import clsx from 'clsx';
import { useSelector } from 'react-redux';

import Header from 'containers/common/Header';
import Layout from 'containers/common/Layout';
import Button from 'components/Button';
import { useController } from 'hooks/index';
import { useFiat } from 'hooks/usePrice';
import { useHistory } from 'react-router-dom';
import CheckIcon from '@material-ui/icons/CheckCircle';
import UpArrowIcon from '@material-ui/icons/ArrowUpward';
import { RootState } from 'state/store';
// import { ellipsis } from '../helpers';
import IWalletState, { IAccountState } from 'state/wallet/types';
import { useAlert } from 'react-alert';

import styles from './IssueAsset.scss';
import { browser } from 'webextension-polyfill-ts';


const IssueAsset = () => {
    const controller = useController();
    const { accounts, activeAccountId }: IWalletState = useSelector(
        (state: RootState) => state.wallet
    );
    const mintSPT = controller.wallet.account.getIssueSPT();
    const [confirmed, setConfirmed] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(false);
    const alert = useAlert();

    const handleConfirm = () => {
        if ((accounts.find(element => element.id === activeAccountId)?.balance || -1) > 0) {
            controller.wallet.account.confirmIssueSPT().then(result => {
                if (result) {
                    alert.removeAll();
                    alert.error(result.message);

                    return;
                }

                setConfirmed(true);
                setLoading(false);

            });

        }
    }
    const handleClosePopup = () => {
        browser.runtime.sendMessage({
            type: "CLOSE_POPUP",
            target: "background"
        });
    }

    const handleCancelTransactionOnSite = () => {
        browser.runtime.sendMessage({
            type: "CANCEL_TRANSACTION",
            target: "background"
        });

        browser.runtime.sendMessage({
            type: "CLOSE_POPUP",
            target: "background"
        });
    }
    return confirmed ? (

        <Layout title="Your transaction is underway" linkTo="/remind" showLogo>
            <CheckIcon className={styles.checked} />
            <div className="body-description">
                Your Tokens is in minting process, you can check the transaction under your history.
      </div>
            <Button
                type="button"
                theme="btn-gradient-primary"
                variant={styles.next}
                linkTo="/home"
                onClick={handleClosePopup}
            >
                Next
      </Button>
        </Layout>
    )


        : (
            <Layout title="Mint Asset" linkTo="/remind" showLogo>
                <section className={styles.txAmount}>
                    {String(mintSPT?.amount) + " " + String(mintSPT?.assetGuid) + " " + String(mintSPT?.receiver)}
                </section>
                {/* <section className={styles.transaction}>
                <div className={styles.row}>
                    From
                    <span>
                        The address to
                    </span>
                </div>
                <div className={styles.row}>
                    To
                    <span> Another span </span>
                </div>
                <div className={styles.row}>
                    Transaction Fee
                    <span>
                        Transaction fee
                    </span>
                </div>
            </section>
            <section className={styles.confirm}>
                <div className={styles.row}>
                    Max Total
                    <span>
                        the max tots
                    </span>
                </div>

                <p className={styles.confirmTransactionOnSite}>Confirm transaction on ?</p> */}


                <div className={styles.actions}>
                    <Button
                        type="button"
                        theme="btn-outline-secondary"
                        variant={clsx(styles.button, styles.close)}
                        onClick={handleCancelTransactionOnSite}
                    >
                        Cancel
                    </Button>

                    <Button
                        type="submit"
                        theme="btn-outline-confirm"
                        variant={styles.button}
                        onClick={handleConfirm}
                        loading={loading}
                    >
                        Confirm
                    </Button>
                </div>
                {/* </section> */}
            </Layout>

        );
}

export default IssueAsset;