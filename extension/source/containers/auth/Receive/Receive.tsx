import React, { useEffect, useState } from 'react';
import { useController, useUtils, useStore } from 'hooks/index';
import QRCode from 'qrcode.react';
import { IconButton, Icon } from 'components/index';
import { Header } from 'containers/common/Header';

export const Receive = () => {
  const { useCopyClipboard, history } = useUtils();
  const [isCopied, copyText] = useCopyClipboard();
  const controller = useController();
  const [loaded, setLoaded] = useState<boolean>(false);
  const { accounts, activeAccountId } = useStore();

  useEffect(() => {
    const getNewAddress = async () => {
      if (await controller.wallet.getNewAddress()) {
        setLoaded(true);
      }
    }

    getNewAddress();
  }, []);

  return (
    <div className="bg-brand-gray">
      <Header normalHeader />
      <IconButton
        type="primary"
        shape="circle"
        onClick={() => history.push('/home')}
      >
        <Icon name="arrow-left" className="w-4 bg-brand-graydark100 text-brand-white" />
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
                type="primary"
                shape="circle"
                onClick={() =>
                  copyText(accounts.find(element => element.id === activeAccountId)!.address.main)
                }
              >
                <Icon name="copy" className="w-4 bg-brand-graydark100 text-brand-white" />
              </IconButton>
              <span>
                {isCopied ? 'Copied address' : 'Copy'}
              </span>
            </div>
          </div>
        ) : <Icon name="loading" className="w-4 bg-brand-graydark100 text-brand-white" />}

      </section>
    </div>
  );
};
