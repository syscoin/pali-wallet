import React, { useEffect, useState } from 'react';
import { useUtils, useStore } from 'hooks/index';
import { ellipsis } from 'utils/index';
import { getController } from 'utils/browser';
import QRCode from 'qrcode.react';
import { Layout, SecondaryButton, Icon } from 'components/index';

export const Receive = () => {
  const { useCopyClipboard, alert } = useUtils();
  const [isCopied, copyText] = useCopyClipboard();

  const controller = getController();
  const { activeAccount, activeNetwork, networks } = useStore();

  const [loaded, setLoaded] = useState<boolean>(false);

  useEffect(() => {
    const setNewAddress = async () => {
      if (
        (activeNetwork.chainId === 57 || activeNetwork.chainId === 5700) &&
        (await controller.wallet.account.setAddress())
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
    <Layout title="RECEIVE SYS" id="receiveSYS-title">
      {loaded && activeAccount ? (
        <div className="flex flex-col items-center justify-center pt-8 w-full">
          <QRCode
            value={activeAccount.address}
            bgColor="#fff"
            fgColor="#000"
            id="qr-code"
            style={{
              height: '240px',
              width: '225px',
              padding: '6px',
              backgroundColor: '#fff',
            }}
          />

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
