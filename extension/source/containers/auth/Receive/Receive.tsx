import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useController, useCopyClipboard } from 'hooks/index';
import QRCode from 'qrcode.react';
import IconButton from '@material-ui/core/IconButton';
import CopyIcon from '@material-ui/icons/FileCopy';
import Header from 'containers/common/Header';
import ArrowBackIcon from '@material-ui/icons/ArrowBack';
import { RootState } from 'state/store';
import IWalletState from 'state/wallet/types';
import Spinner from '@material-ui/core/CircularProgress';
import { useHistory } from 'react-router-dom';

const WalletReceive = () => {
  const [isCopied, copyText] = useCopyClipboard();
  const controller = useController();
  const [loaded, setLoaded] = useState<boolean>(false);
  const { accounts, activeAccountId }: IWalletState = useSelector(
    (state: RootState) => state.wallet
  );

  useEffect(() => {
    const getNewAddress = async () => {
      if (await controller.wallet.getNewAddress()) {
        setLoaded(true);
      }
    }

    getNewAddress();
  }, []);

  const history = useHistory();

  return (
    <div className="bg-brand-gray">
      <Header normalHeader />
      <IconButton
        onClick={() => history.goBack()}
      >
        <ArrowBackIcon />
      </IconButton>
      <section>Receive SYS</section>

      <section>
        {loaded ? (
          <div>
            <div>
              <QRCode
                value={accounts.find(element => element.id === activeAccountId)!.address.main}
                bgColor="#fff"
                fgColor="#000"
                size={180}
              />
              {accounts.find(element => element.id === activeAccountId)!.address.main}
            </div>
            <div>
              <IconButton
                onClick={() =>
                  copyText(accounts.find(element => element.id === activeAccountId)!.address.main)
                }
              >
                <CopyIcon />
              </IconButton>
              <span>
                {isCopied ? 'Copied address' : 'Copy'}
              </span>
            </div>
          </div>
        ) : <Spinner />}

      </section>
    </div>
  );
};

export default WalletReceive;
