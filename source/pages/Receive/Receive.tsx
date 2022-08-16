import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { Layout, SecondaryButton, Icon } from 'components/index';
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
  const activeAccount = useSelector(
    (state: RootState) => state.vault.activeAccount
  );

  const [loaded, setLoaded] = useState<boolean>(false);

  useEffect(() => {
    const setNewAddress = async () => {
      if (
        (activeNetwork.chainId === 57 || activeNetwork.chainId === 5700) &&
        (await controller.wallet.account.sys.setAddress())
      ) {
        setLoaded(true);

        return;
      }

      if (activeAccount.address && networks.ethereum[activeNetwork.chainId])
        setLoaded(true);
    };

    setNewAddress();
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
      {loaded && activeAccount ? (
        <div className="flex flex-col items-center justify-center pt-8 w-full">
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
            <SecondaryButton
              type="button"
              onClick={() => copyText(activeAccount.address)}
            >
              <span className="text-xs">Copy</span>
            </SecondaryButton>
          </div>
        </div>
      ) : (
        <Icon
          name="loading"
          wrapperClassname="absolute top-1/2 left-1/2"
          className="w-4 text-brand-white"
        />
      )}
    </Layout>
  );
};
