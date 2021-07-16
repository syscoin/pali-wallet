import { useSelector } from "react-redux";

import store from "../state/store";
import setupState from "../utils/setupState";

// peace uncle grit essence stuff angle cruise annual fury letter snack globe

export default function Home() {
  const controller = useSelector((state) => state.controller);
  const isLocked = useSelector((state) => state.isLocked);

  const handleConnect = async (event) => {
    event.preventDefault();

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
              disabled={!controller}
            >
              {isLocked ? "Unlock Pali wallet" : "Connect to Pali Wallet"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
