import React, { FC, useState } from 'react';
import { Button, Icon } from 'components/index';;
import { useController } from 'hooks/index';
import TutorialPanel from './TutorialPanel';
import { AuthViewLayout } from 'containers/common/Layout';
import { Header } from 'containers/common/Header';
import { Form, Input } from 'antd';
import { WarningCard } from 'components/Cards';

const ConnectHardwareWalletView: FC = () => {
  const [selected, setSelected] = useState<boolean>(false);
  const controller = useController();

  const onclick = async () => {
    controller.wallet.createHardwareWallet();
  };

  return (
    <>
      <Header normalHeader />
      <AuthViewLayout title="CONNECT HARDWARE WALLET"> </AuthViewLayout>
      <Form
          className="flex justify-center items-center flex-col gap-2 text-center pt-4"
          name="basic"
          labelCol={{ span: 8 }}
          wrapperCol={{ span: 16 }}
          initialValues={{ remember: true }}
          autoComplete="off"
        >
        <div>
          <p className="text-justify text-base text-brand-white px-7">Select a hardware wallet you'd like to use with Pali Wallet</p>
        </div>
            <Form.Item
                name="password"
            >
                <Input className="h-12" />
            </Form.Item>
        </Form>
        <div>
          <WarningCard
            className="w-full rounded text-brand-blueWarningTest border-dashed border border-brand-blueWarningTest text-justify "
            warningText="Don't have a hardware wallet?"
          >
            <br />
            <p className="pt-4">Order a Trezor wallet and keep your founds  
            in cold storage.
            </p>
            <br />
            <a className="text-brand-white" href="https://trezor.io/" target="_blank" rel="noreferrer">
              Buy now
            </a>
          </WarningCard>
        </div>
        <div className="p-7">
          <button className="inline-flex text-sm text-brand-white w-full text-justify bg-brand-navydarker px-4 py-2" onClick={() => setSelected(!selected)}>Learn more
          {selected ? (
            <Icon name="up" className="inline-flex self-center text-sm pl-48" maxWidth={"1"}></Icon>
          ) : (
            <Icon name="down" className="inline-flex self-center text-sm pl-48" maxWidth={"1"}></Icon>
          )}
            
          </button>
          {selected ? (
            <div className="text-brand-white text-sm bg-brand-navylight px-4 py-2">
              <p>
                <b>1 - Connect a hardware wallet</b>
                <br />
                Connect your hardware wallet directly to your computer.
              </p>
              <p className="pt-4">
                <b>2 - Start using sys powered sites and more!</b>
                <br />
                Use your hardware account like you would with any SYS account. Connect to SYS web3 sites, send SYS, buy and store SPT tokens. 
              </p>
            </div>
          ) : (
            <div>
            </div>
          )}
        </div>
        
        <div className="flex justify-center items-center pt-2">
          <Button
            type="submit"
          >
              Connect
          </Button>
        </div>
    </>
  );
};

export default ConnectHardwareWalletView;
