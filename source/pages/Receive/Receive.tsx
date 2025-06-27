import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

import { NeutralButton } from 'components/index';
import { useUtils } from 'hooks/index';
import { RootState } from 'state/store';

export const Receive = () => {
  const { useCopyClipboard, alert } = useUtils();
  const [isCopied, copyText] = useCopyClipboard();
  const { t } = useTranslation();

  const { accounts, activeAccount: activeAccountMeta } = useSelector(
    (state: RootState) => state.vault
  );
  const activeAccount = accounts[activeAccountMeta.type][activeAccountMeta.id];

  useEffect(() => {
    if (!isCopied) return;

    alert.info(t('home.addressCopied'));
  }, [isCopied, alert, t]);

  return (
    <>
      {activeAccount.address ? (
        <div className="flex flex-col items-center justify-center w-full">
          <div id="qr-code">
            <QRCodeSVG
              value={activeAccount.address}
              bgColor="#fff"
              fgColor="#000"
              style={{
                height: '186px',
                width: '186px',
                padding: '6px',
                backgroundColor: '#fff',
                borderRadius: '10px',
              }}
            />
          </div>
          <div className="flex flex-wrap w-[60%]">
            <p
              className="mt-4 text-sm text-center"
              style={{ wordBreak: 'break-all' }}
            >
              {activeAccount.address}
            </p>
          </div>

          <div
            className="relative w-[96%] mt-36 md:static md:mt-6"
            id="copy-address-receive-btn"
          >
            <NeutralButton
              type="button"
              fullWidth={true}
              onClick={() => copyText(activeAccount.address)}
            >
              <span className="text-xs">{t('buttons.copy')}</span>
            </NeutralButton>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-center h-80">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-brand-blue500"></div>
        </div>
      )}
    </>
  );
};
