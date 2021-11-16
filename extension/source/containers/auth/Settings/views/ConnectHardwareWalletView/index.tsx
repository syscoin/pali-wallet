import React, { FC, useState } from 'react';
import { Button } from 'components/index';;
import { useController } from 'hooks/index';
import TutorialPanel from './TutorialPanel';
import { AuthViewLayout } from 'containers/common/Layout';

const ConnectHardwareWalletView: FC = () => {
  const [selected, setSelected] = useState<boolean>(false);
  const controller = useController();

  const onclick = async () => {
    controller.wallet.createHardwareWallet();
  };

  return (
    <AuthViewLayout title="CONNECT HARDWARE WALLET">
      <div
      >
        <span>
          Select a hardware wallet you'd like to use with Pali Wallet
        </span>

        <div>
          <div
            onClick={() => setSelected(!selected)}
          >
            Trezor
          </div>
        </div>

        <span>Don't have a hardware wallet?</span>
        <span>
          Order a Trezor wallet and keep your funds in cold storage.
        </span>

        <a href="https://trezor.io/" target="_blank" rel="noreferrer">
          Buy now
        </a>

        <Button
          type="submit"
          onClick={onclick}
        >
          Connect
        </Button>

        <TutorialPanel />
      </div>
    </AuthViewLayout>
  );
};

export default ConnectHardwareWalletView;
