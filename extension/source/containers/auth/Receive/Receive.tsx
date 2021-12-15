import React, { useEffect, useState } from 'react';
import { useController, useUtils, useAccount, useFormat } from 'hooks/index';
import QRCode from 'qrcode.react';
import { Button, Icon } from 'components/index';
import { AuthViewLayout } from 'containers/common/Layout';

export const Receive = () => {
  const { useCopyClipboard } = useUtils();
  const { ellipsis } = useFormat();
  const [isCopied, copyText] = useCopyClipboard();
  const { activeAccount } = useAccount();
  const controller = useController();

  const [loaded, setLoaded] = useState<boolean>(false);

  useEffect(() => {
    const getNewAddress = async () => {
      if (await controller.wallet.getNewAddress()) {
        setLoaded(true);
      }
    }

    getNewAddress();
  }, []);

  return (
    <AuthViewLayout title="RECEIVE SYS">
      {loaded && activeAccount ? (
        <div className="flex flex-col justify-center items-center pt-8">
          <QRCode
            value={activeAccount.address.main}
            bgColor="#fff"
            fgColor="#000"
            style={{ height: '240px', width: '225px' }}
          />

          <p className="mt-4 text-base">{ellipsis(activeAccount.address.main, 4, 10)}</p>

          <Button
            type="button"
            padding="py-1 bg-brand-navydarker"
            classNameBorder="absolute bottom-14"
            onClick={() =>
              copyText(activeAccount.address.main)
            }
          >
            <span className="text-base">
              {isCopied ? 'Copied address' : 'Copy'}
            </span>
          </Button>
        </div>
      ) : (
        <Icon
          name="loading"
          wrapperClassname="absolute top-1/2 left-1/2"
          className="w-4 text-brand-white"
        />
      )}
    </AuthViewLayout>
  );
};
