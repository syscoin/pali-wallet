import React, {useState, useEffect} from 'react';
import logo from "./assets/images/logosys.svg";
export const ControllerContext = React.createContext();
 
// const MyContext = ({ children }) => {
//     const [isInstalled, setIsInstalled] = useState(false);
//     const [canConnect, setCanConnect] = useState(true);
//     const [balance, setBalance] = useState(0);
//     const [connectedAccount, setConnectedAccount] = useState({});
//     const [connectedAccountAddress, setConnectedAccountAddress] = useState("");
//     const [controller, setController] = useState();
//     useEffect(() => {
//       const callback = (event) => {
//         if (event.detail.SyscoinInstalled) {
//           setIsInstalled(true);

//           if (event.detail.ConnectionsController) {
//             setController(window.ConnectionsController);
//             return;
//           }
//           return;
//         }
//         setIsInstalled(false);
//         window.removeEventListener("SyscoinStatus", callback);
//       }
//       window.addEventListener("SyscoinStatus", callback);
//     }, []);
//     const setup = async () => {
//       const state = await controller.getWalletState();
//       if (state.accounts.length > 0) {
//         controller.getConnectedAccount()
//           .then((data) => {
//             if (data) {
//               setConnectedAccount(data);
//               setConnectedAccountAddress(data.address.main);
//               setBalance(data.balance);
//               return;
//             }
//             setConnectedAccount({});
//             setConnectedAccountAddress("");
//             setBalance(0);
//             return;
//           });
//       }
//     };
//     useEffect(() => {
//       if (controller) {
//         setup();
//         controller.onWalletUpdate(setup);
//       }
//     }, [  controller,]);
  
//     const handleMessageExtension = async () => {
//       await controller.connectWallet();
//       await setup();
//     }
  
//     return (
//       <ControllerContext.Provider value={{
//         isInstalled, setIsInstalled,
//         canConnect, setCanConnect,
//         balance, setBalance,
//         connectedAccount, setConnectedAccount,
//         connectedAccountAddress, setConnectedAccountAddress,
//         controller, setController
//       }}>
//           { children }
//       <div>
//         <nav className="navbar navbar-expand-lg navbar-light static-top">
//           <div className="container">
//             <a
//               className="navbar-brand"
//               href="https://syscoin.org/"
//             >
//               <img
//                 src={logo}
//                 alt="logo"
//                 className="header__logo"
//               />
//             </a>
  
//             <a
//               className="button"
//               href="/"
//             >
//               Home
//             </a>
  
//             <div
//               className="collapse navbar-collapse"
//               id="navbarResponsive"
//             >
//               <ul className="navbar-nav ml-auto">
//                 <button
//                   className="button"
//                   onClick={canConnect ? handleMessageExtension : undefined}
//                   disabled={!isInstalled}>
//                   {connectedAccountAddress === "" ? "Connect to Syscoin Wallet" : connectedAccountAddress}
//                 </button>
//               </ul>
//             </div>
//           </div>
//         </nav>
  
//         {!isInstalled && (
//           <h1 className="app__title">You need to install Syscoin Wallet.</h1>
//         )}
//       </div>
//       </ControllerContext.Provider>
//     )
//   }
export default ControllerContext;