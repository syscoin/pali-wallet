import React, { FC } from 'react';
// import { useController, useFormat, useUtils, useStore } from 'hooks/index';
// import CryptoJS from 'crypto-js';
import { AuthViewLayout } from 'containers/common/Layout';
import { Header } from 'containers/common/Header';
import { Button } from 'antd';

import { WarningCard } from 'components/Cards';
import { AddresCard } from 'components/Cards';
interface IPrivateKeyView {
  id?: string;
}

const PrivateKeyView: FC<IPrivateKeyView> = (/*{ id }*/) => {
  // const controller = useController();
  // const { alert, useCopyClipboard } = useUtils();
  // const { accounts } = useStore();
  // const { ellipsis } = useFormat();

  // // const [isCopied, copyText] = useCopyClipboard();
  // const [checked, setChecked] = useState<boolean>(false);
  // // const [isCopiedAddress, copyAddress] = useState<boolean>(false);
  // const [privKey, setPrivKey] = useState<string>(
  //   '*************************************************************'
  // );

  // const addressClass = clsx(styles.address, {
  //   [styles.copied]: isCopied && isCopiedAddress,
  // });
  // const privKeyClass = clsx(styles.privKey, {
  //   [styles.copied]: isCopied && !isCopiedAddress,
  //   [styles.notAllowed]: !checked,
  // });

  // const onSubmit = (data: any) => {
  //   if (controller.wallet.checkPassword(data.password)) {
  //     setPrivKey(controller.wallet.account.decryptAES(accounts[Number(id)].xprv, CryptoJS.SHA3(data.password).toString()));
  //     setChecked(true);
  //     return;
  //   }

  //   alert.removeAll();
  //   alert.error('Error: Invalid password');
  // };

  // const handleCopyPrivKey = () => {
  //   if (!checked) return;
  //   // copyAddress(false);
  //   // copyText(privKey);
  // };

  return (
    <>
      <Header normalHeader />
      <AuthViewLayout title="X - PUB">
        <div >
          {/* {accounts[Number(id)] && (
            <>
              <div >
                <div>Click to copy your account xpub:</div>
                <span
                // onClick={() => {
                //   copyText(accounts[Number(id)].xpub);
                //   copyAddress(true);
                // }}
                >
                  {ellipsis(accounts[Number(id)].xpub)}
                </span>
              </div>
              <div >
                <span>Please input your wallet password and press enter:</span>
                <form onSubmit={handleSubmit(onSubmit)}>
                  input
                </form>
                <span>Click to copy your private key:</span>
                <div onClick={handleCopyPrivKey}>
                  <span>{ellipsis(privKey)}</span>
                </div>
                <span>
                  <b>Warning:</b> Keep your keys secret! Anyone with your private
                  keys can steal your assets .
                </span>
              </div>
            </>
          )} */}
        </div>
      </AuthViewLayout>
        <AddresCard title={'X - Pub'} account={'0x3126...jdi84r4js0i937d3864c983'}></AddresCard>
        <WarningCard >
        this action will delete your wallet and all accounts
                  associated with this wallet. Please make sure to back up your Wallet
                  seed phase if you would like to access this wallet and associated
                  accounts in the future.
        </WarningCard>
      <div className="flex items-center justify-center pt-32">
        <div className="p-0.5 bg-primary rounded-full ">
          <Button
            className="bg-brand-navy tracking-normal text-base py-2.5 px-12 cursor-pointer rounded-full text-brand-white hover:backgroundImage"
          >
            Close
          </Button>
        </div>
      </div>
    </>
  );
};

export default PrivateKeyView;
