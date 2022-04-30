import React, { useEffect, useState } from 'react';
import { useUtils } from 'hooks/index';
import { ellipsis } from 'utils/index';
import { getController } from 'utils/browser';
import { QRCodeSVG } from 'qrcode.react';
import { Layout, SecondaryButton, Icon } from 'components/index';

export const Receive = () => {
  const { useCopyClipboard, alert } = useUtils();
  const [isCopied, copyText] = useCopyClipboard();

  const controller = getController();
  const activeAccount = controller.wallet.account.getActiveAccount();

  const [loaded, setLoaded] = useState<boolean>(false);

  useEffect(() => {
    const getNewAddress = async () => {
      if (await controller.wallet.getNewAddress()) {
        setLoaded(true);
      }
    };

    getNewAddress();
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
          <div id="qr-code">
            <QRCodeSVG
              value={activeAccount.address.main}
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
            {ellipsis(activeAccount.address.main, 4, 10)}
          </p>

          <div
            className="absolute bottom-12 md:static md:mt-6"
            id="copy-address-receive-btn"
          >
            <SecondaryButton
              type="button"
              onClick={() => copyText(activeAccount.address.main)}
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
