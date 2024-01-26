import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { Layout, NeutralButton } from 'components/index';
import { LoadingComponent } from 'components/Loading';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';
import { ellipsis } from 'utils/index';

export const Receive = () => {
  const { useCopyClipboard, alert } = useUtils();
  const [isCopied, copyText] = useCopyClipboard();
  const { t } = useTranslation();

  const activeNetwork = useSelector(
    (state: RootState) => state.vault.activeNetwork
  );
  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];

  useEffect(() => {
    if (!isCopied) return;

    alert.removeAll();
    alert.success(t('home.addressCopied'));
  }, [isCopied]);

  return (
    <Layout
      title={`${t(
        'receive.receiveTitle'
      )} ${activeNetwork.currency?.toUpperCase()}`}
      id="receiveSYS-title"
    >
      {activeAccount.address ? (
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
              <span className="text-xs">{t('buttons.copy')}</span>
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
