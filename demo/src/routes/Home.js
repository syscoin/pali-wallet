import { useSelector } from "react-redux";

import store from "../state/store";
import setupState from "../utils/setupState";

export default function Home() {
  const controller = useSelector((state) => state.controller);
  const isLocked = useSelector((state) => state.isLocked);
  const isInstalled = useSelector((state) => state.isInstalled);
  const isConnected = useSelector((state) => state.connected);

  const handleConnect = async (event) => {
    event.preventDefault();

    if(!isInstalled) {
      return window.open("https://chrome.google.com/webstore/detail/pali-wallet/mgffkfbidihjpoaomajlbgchddlicgpn?hl=pt-BR&authuser=0", "_blank")
    }

    if (controller) {
      controller.connectWallet().then(async (response) => {
        response && (await setupState(store));
      });
    }
  };

  return (
    <section>
      <div className="inner">
        <h1>Connect your wallet to begin</h1>
        <p>
          To get started, authorize SysMint to connect to an account in your
          Syscoin web extension wallet, such as Pali Wallet. When you select
          “Connect To Pali Wallet”, your wallet will receive a connection
          request which you can approve for your selected account.
        </p>
        <form onSubmit={handleConnect}>
          <div className="btn-center">
            <button
              className="button"
              onClick={handleConnect}
            >
              {isInstalled
                ? (isLocked && isConnected)
                  ? "Unlock Pali wallet"
                  : "Connect to Pali Wallet"
                : "Install Pali Wallet"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
