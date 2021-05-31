import "bootstrap";
import "bootstrap/dist/css/bootstrap.min.css";
import { buttons } from "./data";
import Header from "./components/Header";
import {
  setIsInstalled,
  updateConnectedAccountData,
  updateCanConnect,
  setController,
  setIsConnected
} from "./state/wallet";
// import { useDispatch } from 'react-redux'
// import { useSelector } from 'react-redux'
// import { selectUser } from './States/features/userSlice'
import { useState, useEffect } from 'react'
import Menu from "./Menu"
import store from "./state/store";

const App = () => {
  const [walletIsInstalled, setWalletIsInstalled] = useState(false);
  const [canConnect, setCanConnect] = useState(true);
  const [balance, setBalance] = useState(0);
  const [walletController, setWalletController] = useState();
  const [connectedAccount, setConnectedAccount] = useState({});
  const [connectedAccountAddress, setConnectedAccountAddress] = useState("");
  // // const dispatch = useDispatch();
  // // const user = useSelector(selectUser);

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
    }

    window.addEventListener("SyscoinStatus", callback);
  }, []);

  const setup = async () => {
    const state = await walletController.getWalletState();

    if (state.accounts.length > 0) {
      walletController.getConnectedAccount()
        .then((data) => {
          if (data) {
            setConnectedAccount(data);
            setConnectedAccountAddress(data.address.main);
            setBalance(data.balance);

            store.dispatch(updateConnectedAccountData({
              balance: data.balance,
              connectedAccount: data,
              connectedAccountAddress: data.address.main
            }));

            return;
          }

          setConnectedAccount({});
          setConnectedAccountAddress("");
          setBalance(0);

          store.dispatch(updateConnectedAccountData({
            balance: 0,
            connectedAccount: {},
            connectedAccountAddress: ''
          }));

          return;
        });
    }
  };

  useEffect(() => {
    if (walletController) {
      setup();

      walletController.onWalletUpdate(setup);
    }
  }, [
    walletController,
  ]);

//   useEffect(() => {
//     const {isInstalled} = store.getState
//      if(isInstalled !== controller.isInstalled){

//    (dispatch(setIsInstalled({
//      isInstalled: isInstalled,
//    })))
   
//  }})


  const handleMessageExtension = async () => {
    await store.getState().controller.connectWallet();
    await setup();
  }

  return (

    <div className="app">
      {/* <Header handleMessageExtension={handleMessageExtension} /> */}
      
      {!store.getState().isInstalled ? 
        <p>Install the Wallet</p> :<Menu />
      }
    </div>
  );
}

export default App;