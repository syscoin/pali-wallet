import { useEffect } from "react";
import { useSelector } from "react-redux";




// peace uncle grit essence stuff angle cruise annual fury letter snack globe

const  Home = () => {
  const accountData = useSelector((state) => state.connectedAccountData);
  const controller = useSelector((state) => state.controller);
  const isInstalled = useSelector((state) => state.isInstalled);

  const handleMessageExtension = async () => {
    controller
      ? await controller.connectWallet()
      : await window.ConnectionsController.connectWallet();
  };
  const truncate = (str) => {
    return str.substr(0, 9) + "..." + str.substr(-5);
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
        <form onSubmit={handleMessageExtension}>
          <select className="form-control">
            <option>1</option>
            <option>2</option>
            <option>3</option>
          </select>

          <div className="btn-center">
          <button
              title={accountData.connectedAccountAddress}
              className="button"
              onClick={handleMessageExtension}
              disabled={!isInstalled}>
              {accountData.connectedAccountAddress === ""
              ? "Connect to Syscoin Wallet"
              : truncate(accountData.connectedAccountAddress)}
          </button>
          </div>
        </form>
      </div>
    </section>
  );
}
export default Home