import "bootstrap";
import "bootstrap/dist/css/bootstrap.min.css";
import { useEffect, useState, useCallback } from "react";
import { buttons } from "./data";
import Header from "./components/Header";

const App = () => {
  const [isInstalled, setIsInstalled] = useState(false);
  const [canConnect, setCanConnect] = useState(true);
  const [balance, setBalance] = useState(0);
  const [controller, setController] = useState();
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

  const RenderButtons = () => {
    return buttons.map((item) => {
      return <a key={item.route} className="button" href={item.route}>{item.title}</a>
    })
  }

  // const handleAssetSelected = (event) => {
  //   if (connectedAccount) {
  //     const selectedAsset = connectedAccount.assets.filter((asset) => asset.assetGuid == event.target.value);

  //     if (selectedAsset[0]) {
  //       setSelectedAsset(selectedAsset[0]);

  //       return;
  //     }

  //     setSelectedAsset(null);
  //   }
  // };

  // const handleGetWalletState = async (evt) => {
  //   const inputs = document.querySelectorAll("input");
  //   alert(`Submitting Asset Guid: ${evt.target.assetGuid.value}, Amount: ${evt.target.amount.value}, Fee: ${evt.target.fee.value}, RBF: ${evt.target.rbf.value}, Sys Address: ${evt.target.receiver.value}`)
  //   console.log("Sending tokens");
  //   // await controller.handleCreateToken(8,
  //   //   "NikBar",
  //   //   1000,
  //   //    0.00001,
  //   //   "larara lelere lololo lululu",
  //   //   "tsys1qvaf78steqrvsljch9mn6n559ljj5g2xs7gvepq",
  //   //   false);
  //   // (rbf: boolean, fee: number, assetGuid: string, amount: number, receiver: string)
  //   await controller.handleIssueAsset(
  //     false,
  //     0.00001,
  //     "umasset",
  //     200,
  //     "txsdkasod"
  //   )
  //   //(rbf: boolean, fee: number, assetGuid: string, nfthash: string, receiver: string) => {
  //  await controller.handleIssueNFT(
  //      true,
  //      0.0001,
  //      "umassetguid",
  //      "umnfthash",
  //      "umaconta"
  //    )
  //   return await controller.getWalletState();
  // }

  // const clearData = (inputs) => {
  //   for (let input of inputs) {
  //     input.value = "";
  //   }

  //   setToAddress("");
  //   setAmount(0);
  //   setFee(0.00001);
  // }

  // const handleSendToken = async (sender, receiver, amount, fee, token) => {
  //   const inputs = document.querySelectorAll("input");

  //   if (token !== null) {
  //     await controller.handleSendToken(sender, receiver, amount, fee, token, true, !checked);

  //     clearData(inputs);

  //     return;
  //   }

  //   await controller.handleSendToken(sender, receiver, amount, fee, null, false, !checked);

  //   clearData(inputs);

  //   return;
  // }

  return (
    <div className="app">
      {controller ? (
        <div>
          <Header
            canConnect={canConnect}
            handleMessageExtension={handleMessageExtension}
            isInstalled={isInstalled}
            connectedAccountAddress={connectedAccountAddress}
          />

          <div className="menu">
            <RenderButtons />
          </div>
        </div>
      ) : (
        <div>
          <p>...</p>
          <h1>You need to install Syscoin Wallet.</h1>
        </div>
      )}
    </div>
  );
}

export default App;
