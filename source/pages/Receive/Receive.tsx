import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { Layout, NeutralButton } from 'components/index';
import { LoadingComponent } from 'components/Loading';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { getController } from 'utils/browser';
import { ellipsis } from 'utils/index';

export const Receive = () => {
  const { useCopyClipboard, alert } = useUtils();
  const [isCopied, copyText] = useCopyClipboard();

  const controller = getController();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const networks = useSelector((state: RootState) => state.vault.networks);
  const { accounts, activeAccountId } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountId];

  const isBitcoinBased = useSelector(
    (state: RootState) => state.vault.isBitcoinBased
  );

  const [loaded, setLoaded] = useState<boolean>(false);

  useEffect(() => {
    const abortController = new AbortController();

    const setNewAddress = async () => {
      if (isBitcoinBased) {
        await controller.wallet.account.sys.setAddress();

        setLoaded(true);

        return;
      }

      if (
        !isBitcoinBased &&
        activeAccount.address &&
        networks.ethereum[activeNetwork.chainId]
      ) {
        setLoaded(true);
        return;
      }
    };

    setNewAddress();

    return () => {
      abortController.abort();
    };
  }, []);

  useEffect(() => {
    if (!isCopied) return;

    alert.removeAll();
    alert.success('Address successfully copied');
  }, [isCopied]);

  return (
    <Layout
      title={`RECEIVE ${activeNetwork.currency?.toUpperCase()}`}
      id="receiveSYS-title"
    >
      {loaded && activeAccount.address ? (
        <div className="flex flex-col items-center justify-center w-full">
          <div id="qr-code">
            <QRCodeSVG
              value={activeAccount.address}
              bgColor="#fff"
              fgColor="#000"
              style={{
                height: '240px',
                width: '225px',
                padding: '6px',
                backgroundColor: '#fff',
              }}
            />
          </div>

          <p className="mt-4 text-base">
            {ellipsis(activeAccount.address, 4, 10)}
          </p>

          <div
            className="absolute bottom-12 md:static md:mt-6"
            id="copy-address-receive-btn"
          >
            <NeutralButton
              type="button"
              onClick={() => copyText(activeAccount.address)}
            >
              <span className="text-xs">Copy</span>
            </NeutralButton>
          </div>
        </div>
      ) : (
        <div className="flex items-center h-80">
          <LoadingComponent />
        </div>
      )}
    </Layout>
  );
};
