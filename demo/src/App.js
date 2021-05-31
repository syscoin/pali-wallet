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
} from "./States/features/userSlice"
import { useDispatch } from 'react-redux'
import { useSelector } from 'react-redux'
import { selectUser } from './States/features/userSlice'
import { useState, useEffect } from 'react'
import Menu from "./Menu"
import store from "./States/redux/store"
const App = () => {

  const [isInstalled, setIsInstalled] = useState(false);
  const [canConnect, setCanConnect] = useState(true);
  const [balance, setBalance] = useState(0);
  const [controller, setController] = useState();
  const [connectedAccount, setConnectedAccount] = useState({});
  const [connectedAccountAddress, setConnectedAccountAddress] = useState("");
  const dispatch = useDispatch();
  const user = useSelector(selectUser);


  useEffect(() => {
    const callback = (event) => {
      // const { isIstalled } = userSlice.actions
      if (event.detail.SyscoinInstalled) {
        setIsInstalled(true);

        if (event.detail.ConnectionsController) {
          setController(window.ConnectionsController);
          return;
        }

        return;
      }

      setIsInstalled(false);

      window.removeEventListener("SyscoinStatus", callback);


    }

    window.addEventListener("SyscoinStatus", callback);
  }, []);



  const setup = async () => {
    const state = await controller.getWalletState();

    if (state.accounts.length > 0) {
      controller.getConnectedAccount()
        .then((data) => {
          if (data) {
            setConnectedAccount(data);
            setConnectedAccountAddress(data.address.main);
            setBalance(data.balance);

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
    if (controller) {
      setup();

      controller.onWalletUpdate(setup);
    }
  }, [
    controller,
  ]);

//   useEffect(() => {
//     const {isInstalled} = store.getState
//      if(isInstalled !== controller.isInstalled){

//    (dispatch(setIsInstalled({
//      isInstalled: isInstalled,
//    })))
   
//  }})


  const handleMessageExtension = async () => {
    await controller.connectWallet();
    await setup();
  }

  return (

    <div className="app">
      {isInstalled ?
        <Menu /> : <a>Install</a>}
    </div>
  );
}

export default App;