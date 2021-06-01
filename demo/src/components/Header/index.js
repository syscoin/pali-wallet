import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";

import logo from "../../assets/images/logosys.svg";
import { useDispatch } from "react-redux";

import {
  setIsInstalled,
  updateConnectedAccountData,
  updateCanConnect,
  setController,
  setIsConnected,
} from "../../state/wallet";
import store from "../../state/store";

// peace uncle grit essence stuff angle cruise annual fury letter snack globe       ---- frase wallet
const Header = (props) => {
  const [walletIsInstalled, setWalletIsInstalled] = useState(false);
  const [canConnect, setCanConnect] = useState(false);
  const [balance, setBalance] = useState(0);
  const [controller, setController] = useState();
  const [connectedAccount, setConnectedAccount] = useState({});
  const [connectedAccountAddress, setConnectedAccountAddress] = useState();
  // const dispatch = useDispatch();
  // const user = useSelector(selectUser);

  // useEffect(() => {
  //   const callback = (event) => {
  //     // const { isIstalled } = userSlice.actions
  //     if (event.detail.SyscoinInstalled) {
  //       setWalletIsInstalled(true);
  //       store.dispatch(setIsInstalled(true));

  //       if (event.detail.ConnectionsController) {
  //         setWalletController(window.ConnectionsController);
  //         store.dispatch(setController(window.ConnectionsController));

  //         return;
  //       }

  //       return;
  //     }

  //     setWalletIsInstalled(false);
  //     store.dispatch(setIsInstalled(false));

  //     window.removeEventListener("SyscoinStatus", callback);
  //   };

  //   window.addEventListener("SyscoinStatus", callback);
  // }, []);

  const setup = async () => {
    const _controller = await store.getState().controller;
    const walletState = await store.getState().controller.getWalletState();

    if (walletState.accounts.length > 0) {
      _controller.getConnectedAccount().then((data) => {
        console.log(data, "fsdafsdahflhsdakghk");
        if (data) {
          setConnectedAccount(data);
          setConnectedAccountAddress(data.address.main);
          setBalance(data.balance);
          setController(_controller);

          return;
        }

        setConnectedAccount({});
        setConnectedAccountAddress("");
        setBalance(0);

        return;
      });
    }
  };

  useEffect(() => {
    setup();
    if (controller) {
      setup();

      controller.onWalletUpdate(setup);
    }
  }, [controller]);

  const handleMessageExtension = async () => {
    controller && (await controller.connectWallet());
    await setup();
  };

  return (
    <div>
      <nav className="navbar navbar-expand-lg navbar-light static-top">
        <div className="container">
          <a className="navbar-brand" href="https://syscoin.org/">
            <img src={logo} alt="logo" className="header__logo" />
          </a>

          <Link className="button" to="/">
            Home
          </Link>

          <div className="collapse navbar-collapse" id="navbarResponsive">
            <ul className="navbar-nav ml-auto">
              <button
                className="button"
                onClick={handleMessageExtension}
                disabled={!store.getState().isInstalled}
              >
                {!connectedAccountAddress
                  ? "Connect to Syscoin Wallet"
                  : connectedAccountAddress}
                {/* {localStorage.wallet.connectedAccountData.connectedAccountAddress} */}
              </button>
            </ul>
          </div>
        </div>
      </nav>
    </div>
  );
};

export default Header;
