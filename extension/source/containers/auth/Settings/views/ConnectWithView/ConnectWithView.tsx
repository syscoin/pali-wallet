import { Button } from 'components/Button';
import { AuthViewLayout } from 'containers/common/Layout';
import React, { FC } from 'react';
import LogoImage from 'assets/images/logo-s.svg';
interface IConnectWith {}
const ConnectWith: FC<IConnectWith> = ({}) => {
  return (
    <div>
      <AuthViewLayout title="CONNECT WITH"> </AuthViewLayout>
      <div className="flex flex-col gap-1 pt-4 p-4 text-white">
        <div className="justify-center items-center text-center">
          <p className="text-sm ">PALI WALLET</p>
          <p className="text-sm text-brand-royalBlue">sysmint.paliwallet.com</p>
        </div>
        <div className="pt-10">
          <div className="bg-brand-navydark rounded mb-2 p-1 inline-flex w-full">
            <img
              src={`/${LogoImage}`}
              className="mx-auto w-14 rounded-full inline-flex"
              alt="Syscoin"
            />
            <div>
              <p className="text-sm text-brand-royalBlue">Account123</p>
              <p className="text-sm">0x31267d38ql6qml...3909hslg2cc9883</p>
            </div>
          </div>
          <div className="bg-brand-navydark rounded mb-2 p-1 inline-flex w-full">
            <img
              src={`/${LogoImage}`}
              className="mx-auto w-14 rounded-full inline-flex"
              alt="Syscoin"
            />
            <div>
              <p className="text-sm text-brand-royalBlue">Account123</p>
              <p className="text-sm">0x31267d38ql6qml...3909hslg2cc9883</p>
            </div>
          </div>
          <div className="bg-brand-navydark rounded mb-2 p-1 inline-flex w-full">
            <img
              src={`/${LogoImage}`}
              className="mx-auto w-14 rounded-full inline-flex"
              alt="Syscoin"
            />
            <div>
              <p className="text-sm text-brand-royalBlue">Account123</p>
              <p className="text-sm">0x31267d38ql6qml...3909hslg2cc9883</p>
            </div>
          </div>
        </div>
        <div className="pt-16 flex justify-center items-center">
          <Button type="submit">Next</Button>
        </div>
      </div>
    </div>
  );
};
export default ConnectWith;
