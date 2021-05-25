import "bootstrap";
import "bootstrap/dist/css/bootstrap.min.css";
import { buttons } from "./data";
import Header from "./components/Header";

const App = () => {
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
  //   //    10,
  //   //   "larara lelere lololo lululu",
  //   //   "tsys1qvaf78steqrvsljch9mn6n559ljj5g2xs7gvepq",
  //   //   false);
  //   // (rbf: boolean, fee: number, assetGuid: string, amount: number, receiver: string)
  //   await controller.handleIssueSPT(
  //     false,
  //     10,
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
  //   setFee(10);
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
      <Header />

      <div className="menu">
        <RenderButtons />
      </div>
    </div>
  );
}

export default App;