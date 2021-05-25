import React, { useState, useContext, createContext, useEffect } from 'react';
export const InitController = createContext();
export default function InitControllerProvider({children}) {
 const [controller, setController] = useState();


  const [isInstalled, setIsInstalled] = useState(false);
  const [canConnect, setCanConnect] = useState(true);
  const [balance, setBalance] = useState(0);
  const [connectedAccount, setConnectedAccount] = useState({});
  const [connectedAccountAddress, setConnectedAccountAddress] = useState("");
 
  useEffect(() => {
    const callback = (event) => {
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

  const handleMessageExtension = async () => {
    await controller.connectWallet();
    await setup();
  }

  return (
    <InitController.Provider
      value={{
        controller, setController
      }}>
      {children}
      <button
                className="button"
                onClick={canConnect ? handleMessageExtension : undefined}
                disabled={!isInstalled}>
                {connectedAccountAddress === "" ? "Connect to Syscoin Wallet" : connectedAccountAddress}
              </button>
    </InitController.Provider>
  );
};
export function useInitController() {
    const context = useContext(InitController)
      if (!context) throw new Error("blew blew")
    const { controller, setController } = context;
    return  {controller, setController }
}
