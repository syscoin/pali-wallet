import { useEffect, useState } from "react";
import logo from "./assets/images/logosys.svg";

const App = () => {
  const [isInstalled, setIsInstalled] = useState(false);
  const [list, setList] = useState([]);
  const [canConnect, setCanConnect] = useState(true);
  const [address, setAddress] = useState('Connect to Syscoin Wallet');
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    if (!window.SyscoinWallet) {
      setIsInstalled(false);

      return;
    }

    setIsInstalled(true);

    window.addEventListener("message", (event) => {
      if (event.data.type === 'RESPONSE_FROM_EXTENSION') {
        setList(event.data.controller.wallet.accounts);

        if (event.data.controller.wallet.canConnect) {
          setCanConnect(true)

          return;
        }

        setCanConnect(false)
      }
    });
  }, []);

  useEffect(() => {
    list.map((account) => {
      setBalance(account.balance);
      setAddress(account.address.main);
    });
  }, [
    list,
  ]);

  const handleMessageExtension = () => {
    window.postMessage({ type: "FROM_PAGE" }, "*");
  }

  const RenderList = (props) => {
    return props.list.map((item, index) => {
      return (
        <tr key={index}>
          <td>{item.label}</td>
          <td>{item.balance}</td>
          {/* <td>No transactions</td> TODO */} 
          <td>{item.address.main}</td>
        </tr>
      )
    });
  }

  return (
    <div className="app">
      <header className="header">
        <img src={logo} alt="logo" className="header__logo" />
        
        <div className="header__info">
          <p className="header__balance">{balance}</p>

          <button
            className="header__buttonConnect"
            onClick={canConnect ? handleMessageExtension : undefined}
            disabled={!isInstalled}
          >
            {address}
          </button>
        </div>
      </header>

      {!isInstalled && (<h1 className="app__title">You need to install Syscoin Wallet.</h1>)}

      <table className="table">
        <thead>
          <tr>
            <td>Accounts</td>
            <td>Balance</td>
            {/* <td>Transactions</td> TODO */}
            <td>Address</td>
          </tr>
        </thead>

        <tbody id="tbody">
          {list.length > 0 && (<RenderList list={list} />)}
        </tbody>
      </table>
    </div>
  );
}

export default App;
