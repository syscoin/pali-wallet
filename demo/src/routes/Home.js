import { useSelector } from "react-redux";

import store from "../state/store";
import setupState from "../utils/setupState";

// peace uncle grit essence stuff angle cruise annual fury letter snack globe

export default function Home() {
  const accountData = useSelector((state) => state.connectedAccountData);
  const controller = useSelector((state) => state.controller);
  const isConnected = useSelector((state) => state.connected);

  const handleConnect = async (event) => {
    event.preventDefault(store);

    if (controller && !isConnected) {
      controller.connectWallet().then(async (response) => {
        response && (await setupState(store));

        return;
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
        “Connect To Wallet”, your wallet will receive a connection request 
        which you can approve for your selected account.
        </p>
        <form onSubmit={handleConnect}>
          {/* <select className="form-control">
            <option>1</option>
            <option>2</option>
            <option>3</option>
          </select> */}

          <div className="btn-center">
            <button
              title={accountData.connectedAccountAddress}
              className="button"
              onClick={handleConnect}
              disabled={!controller}
            >
              Connect to Pali Wallet
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
