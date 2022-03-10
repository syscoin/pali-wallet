import React, { useEffect, useState } from 'react';
import { useUtils, useAccount } from 'hooks/index';
import { ellipsis, getController } from 'utils/index';
import QRCode from 'qrcode.react';
import { Layout, SecondaryButton, Icon } from 'components/index';

export const Receive = () => {
  const { useCopyClipboard } = useUtils();
  const [isCopied, copyText] = useCopyClipboard();
  const { activeAccount } = useAccount();
  const controller = getController();

  const [loaded, setLoaded] = useState<boolean>(false);

  useEffect(() => {
    const getNewAddress = async () => {
      if (await controller.wallet.getNewAddress()) {
        setLoaded(true);
      }
    };

    getNewAddress();
  }, []);

  return (
    <Layout title="RECEIVE SYS" id="receiveSYS-title">
      {loaded && activeAccount ? (
        <div className="flex flex-col items-center justify-center pt-8 w-full">
          <QRCode
            value={activeAccount.address.main}
            bgColor="#fff"
            fgColor="#000"
            id="qr-code"
            style={{ height: '240px', width: '225px' }}
          />

          <p className="mt-4 text-base">
            {ellipsis(activeAccount.address.main, 4, 10)}
          </p>

          <div className="absolute bottom-12" id="copy-address-receive-btn">
            <SecondaryButton
              type="button"
              onClick={() => copyText(activeAccount.address.main)}
            >
              <span className="text-xs">
                {isCopied ? 'Copied address' : 'Copy'}
              </span>
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
