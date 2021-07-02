import { useEffect } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";

import logo from "../../images/logo.svg";
import { elementEventHandler } from "../../utils/elementEventHandler";

const Header = () => {
  const accountData = useSelector((state) => state.connectedAccountData);
  const controller = useSelector((state) => state.controller);
  const isInstalled = useSelector((state) => state.isInstalled);
  const isConnected = useSelector((state) => state.connected);
  const { connectedAccountAddress } = useSelector(
    (state) => state.connectedAccountData
  );
  const handleMessageExtension = async () => {
    controller
      ? await controller.connectWallet()
      : await window.ConnectionsController.connectWallet();
  };

  useEffect(() => {
    const dropdown = document.querySelectorAll(".dropdown");
    const mobilemenu = document.querySelector(".mobilemenu");
    const desktopmenu = document.querySelector(".desktopmenu");

    // menu open submenu
    dropdown.forEach(elementEventHandler(["click"], "open"));

    // mobile menu open/close
    elementEventHandler(["click"], "open", function () {
      desktopmenu.classList.toggle("open");
      document.querySelector("body").classList.toggle("no-scroll");
    })(mobilemenu);

    // remove events when component is unmounted
    return () =>
      dropdown.forEach(
        elementEventHandler(["click", "touchstart"], "open", "remove")
      );
  }, []);

  const trucate = (str) => {
    return str.substr(0, 5) + "..." + str.substr(-13);
  };

  return (
    <header>
      <nav>
        <div className="mobilemenu">
          <a className="openmenu">
            <i className="icon-menu"></i>
          </a>
          <Link to="/" className="logo">
            <embed src={logo} />
          </Link>
        </div>
        <div className="desktopmenu">
          
          <div className="menu">
            <Link to="/" className="logo">
              <embed src={logo} />
            </Link>
            <h1>Token Creation Tool</h1>
            <div className="nav-address">
            <h1>{isConnected ?
            <>
            <div class="bubble">
              <span class="bubble-outer-dot">
              <span class="bubble-inner-dot">
              </span>
              </span>
            </div>
            <span
              className="accountName"
              rel="noopener noreferrer"
              target="_blank"
              title={accountData.connectedAccountAddress}
              onClick={handleMessageExtension}
              disabled={!isInstalled} >
              { accountData.connectedAccount?.label }
            </span>
            <span
              className="accountAddress"
              title={accountData.connectedAccountAddress}
              onClick={handleMessageExtension}
              disabled={!isInstalled}>
              { trucate(accountData.connectedAccountAddress)}
            </span>
            </>
            :
            <>
              <div class="bubble-off">
            <span class="bubble-outer-dot-off">
            <span class="bubble-inner-dot-off">
            </span>
            </span>
          </div> 
            Disconnected</>}</h1>

          </div>
            <ul>
              <li>
                <Link to="/dashboard" className="active">
                  Dashboard
                </Link>
              </li>
              <li>
                <a className="dropdown">
                  Create <i className="icon-down-open"></i>
                </a>
                <ul>
                  <li>
                    <Link to="/create-spt">Standard Token (Fungible)</Link>
                  </li>
                  <li>
                    <Link to="/create-nft">NFT (Non-Fungible)</Link>
                  </li>
                </ul>
              </li>
              <li>
                <a className="dropdown">
                  Manage <i className="icon-down-open"></i>
                </a>
                <ul>
                  <li>
                    <Link to="/issue-spt">
                      Issue Fungibles Into Circulation
                    </Link>
                  </li>
                  <li>
                    <Link to="/update">Update Properties</Link>
                  </li>
                  <li>
                    <Link to="/transfer">Transfer Ownership</Link>
                  </li>
                </ul>
              </li>

              <li>
                <Link to="/about">About</Link>
              </li>
            </ul>
          </div>
          <div className="navbottom">

            <a
              href="https://syscoin.org"
              rel="noopener noreferrer"
              target="_blank"
            >
              Syscoin Platform
            </a>
            <a
              href="https://support.syscoin.org/"
              rel="noopener noreferrer"
              target="_blank"
            >
              Support
            </a>
            <a
              href="https://syscoin.org/wallets-and-exchanges"
              rel="noopener noreferrer"
              target="_blank"
            >
              Wallets
            </a>
            <a
              href="https://github.com/syscoin"
              rel="noopener noreferrer"
              target="_blank"
            >
              Github
            </a>
            <a
              href="https://discord.gg/RkK2AXD"
              rel="noopener noreferrer"
              target="_blank"
            >
              Discord
            </a>
            <a
              href="https://syscoin.org/news"
              rel="noopener noreferrer"
              target="_blank"
            >
              News
            </a>
          </div>
        </div>
      </nav>
    </header>
  );
};

export default Header;
