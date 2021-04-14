import logo from './logo.svg';
import './App.css';
import React, { useEffect, useState } from 'react';

function App() {
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
      if (event.data.type == 'RESPONSE_FROM_EXTENSION') {
        setList(event.data.controller.wallet.accounts);

        if (event.data.controller.wallet.canConnect) {
          setCanConnect(true)

          return;
        }

        setCanConnect(false)
      }
    });
  }, []);

  const handleMessageExtension = () => {
    window.postMessage({ type: "FROM_PAGE" }, "*");
  }

  return (
    <div className="App">
      <header className="App-header">
        <button onClick={handleMessageExtension}>
          click me
        </button>
        {!isInstalled && <h1>install syscoin</h1>}
      </header>
    </div>
  );
}

export default App;
