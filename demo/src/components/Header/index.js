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
  const [canConnect, setCanConnect] = useState(true);
  const [balance, setBalance] = useState(0);
  const [walletController, setWalletController] = useState();
  const [connectedAccount, setConnectedAccount] = useState({});
  const [connectedAccountAddress, setConnectedAccountAddress] = useState("");
  // const dispatch = useDispatch();
  // const user = useSelector(selectUser);

  useEffect(() => {
    const callback = (event) => {
      // const { isIstalled } = userSlice.actions
      if (event.detail.SyscoinInstalled) {
        setWalletIsInstalled(true);
        store.dispatch(setIsInstalled(true));

        if (event.detail.ConnectionsController) {
          setWalletController(window.ConnectionsController);
          store.dispatch(setController(window.ConnectionsController));

          return;
        }

        return;
      }

      setWalletIsInstalled(false);
      store.dispatch(setIsInstalled(false));

      window.removeEventListener("SyscoinStatus", callback);
    };

    window.addEventListener("SyscoinStatus", callback);
  }, []);

  const setup = async () => {
    const state = await walletController.getWalletState();

    if (state.accounts.length > 0) {
      walletController.getConnectedAccount().then((data) => {
        if (data) {
          setConnectedAccount(data);
          setConnectedAccountAddress(data.address.main);
          setBalance(data.balance);

          store.dispatch(
            updateConnectedAccountData({
              balance: data.balance,
              connectedAccount: data,
              connectedAccountAddress: data.address.main,
            })
          );

          return;
        }

        setConnectedAccount({});
        setConnectedAccountAddress("");
        setBalance(0);

        store.dispatch(
          updateConnectedAccountData({
            balance: 0,
            connectedAccount: {},
            connectedAccountAddress: "",
          })
        );

        return;
      });
    }
  };

  // useEffect(() => {
  //   if (walletController) {
  //     setup();

  //     walletController.onWalletUpdate(setup);
  //   }
  // }, [walletController]);

  const handleMessageExtension = async () => {
    await store.getState().controller.connectWallet();
    await setup();
  }

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
                onClick={canConnect ? handleMessageExtension : undefined}
                disabled={!store.getState().isInstalled}
              >
                {store.getState().connectedAccountData.connectedAccountAddress === "" ? "Connect to Syscoin Wallet" : store.getState().connectedAccountData.connectedAccountAddress}
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
