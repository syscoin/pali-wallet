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
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus quam
          ex, suscipit sagittis orci tincidunt, maximus posuere dui. Morbi porta
          magna hendrerit velit molestie ultricies. Sed a tellus est. Quisque ut
          velit quis orci rutrum congue ut euismod odio. Nunc non ipsum lacus.
          Pellentesque at urna sed arcu ultricies fringilla sit amet a purus.
        </p>
        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus quam
          ex, suscipit sagittis orci tincidunt, maximus posuere dui. Morbi porta
          magna hendrerit velit molestie ultricies. Sed a tellus est. Quisque ut
          velit quis orci rutrum congue ut euismod odio. Nunc non ipsum lacus.
          Pellentesque at urna sed arcu ultricies fringilla sit amet a purus.
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
