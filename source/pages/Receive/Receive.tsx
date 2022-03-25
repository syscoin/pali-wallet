import React, { useEffect, useState } from 'react';
import { useUtils, useStore } from 'hooks/index';
import { ellipsis, getController } from 'utils/index';
import QRCode from 'qrcode.react';
import { Layout, SecondaryButton, Icon } from 'components/index';

export const Receive = () => {
  const { useCopyClipboard } = useUtils();
  const [isCopied, copyText] = useCopyClipboard();

  const controller = getController();
  const { activeNetworkType } = useStore();
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

  return (
    <Layout
      title={activeNetworkType === 'syscoin' ? 'RECEIVE SYS' : 'RECEIVE ETH'}
      id="receiveSYS-title"
    >
      {loaded && activeAccount && activeNetworkType ? (
        <div className="flex flex-col items-center justify-center pt-8 w-full">
          <QRCode
            value={
              activeNetworkType === 'syscoin'
                ? activeAccount.address.main
                : activeAccount.web3Address
            }
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
            {activeNetworkType === 'syscoin'
              ? ellipsis(activeAccount.address.main, 4, 10)
              : ellipsis(activeAccount.web3Address, 4, 10)}
          </p>

          <div
            className="absolute bottom-12 md:static md:mt-6"
            id="copy-address-receive-btn"
          >
            <SecondaryButton
              type="button"
              onClick={
                activeNetworkType === 'syscoin'
                  ? () => copyText(activeAccount.address.main)
                  : () => copyText(activeAccount.web3Address)
              }
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
