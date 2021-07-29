import { useCallback, useEffect } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";

import logo from "../images/logo.svg";
import { elementEventHandler } from "../utils/elementEventHandler";

const Header = () => {
  const accountData = useSelector((state) => state.connectedAccountData);
  const controller = useSelector((state) => state.controller);
  const isConnected = useSelector((state) => state.connected);

  const connectWallet = async () => {
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


  const truncate = (str) => {
    return str.substr(0, 5) + "..." + str.substr(-13);
  };

  const handleClick = useCallback(() => {
    const desktopmenu = document.querySelector(".desktopmenu");
    const body = document.querySelector("body");

    if (window.innerWidth <= 900) {
      desktopmenu.classList.toggle("open");
      body.classList.toggle("no-scroll");
    }
  }, []);

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
              {isConnected ? (
                <div
                  className="account-info"
                  onClick={connectWallet}
                >
                  <span>
                    <div className="bubble">
                      <span className="bubble-outer-dot">
                        <span className="bubble-inner-dot"></span>
                      </span>
                    </div>
                    <h1 title="Switch Account">
                      {accountData.connectedAccount?.label}
                    </h1>
                  </span>
                  <span
                    className="account-address"
                    title={accountData.connectedAccountAddress}
                  >
                    {truncate(accountData.connectedAccountAddress)}
                  </span>
                </div>
              ) : (
                <div className="account-info ">
                  <span>
                    <div className="bubble-off">
                      <span className="bubble-outer-dot-off">
                        <span className="bubble-inner-dot-off"></span>
                      </span>
                    </div>
                    <h1>Disconnected</h1>
                  </span>
                </div>
              )}
            </div>
            <ul>
              <li>
                <Link to="/" className="active" onClick={handleClick}>
                  Dashboard
                </Link>
              </li>
              <li>
                <a className="dropdown">
                  Create <i className="icon-down-open"></i>
                </a>
                <ul>
                  <li>
                    <Link to="/create-spt" onClick={handleClick}>Standard Token (Fungible)</Link>
                  </li>
                  <li>
                    <Link to="/create-nft" onClick={handleClick}>NFT (Non-Fungible)</Link>
                  </li>
                </ul>
              </li>
              <li>
                <a className="dropdown">
                  Manage <i className="icon-down-open"></i>
                </a>
                <ul>
                  <li>
                    <Link to="/issue-spt" onClick={handleClick}>
                      Issue Fungibles Into Circulation
                    </Link>
                  </li>
                  <li>
                    <Link to="/update" onClick={handleClick}>Update Properties</Link>
                  </li>
                  <li>
                    <Link to="/transfer" onClick={handleClick}>Transfer Ownership</Link>
                  </li>
                </ul>
              </li>

              <li>
                <Link to="/about" onClick={handleClick}>About</Link>
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
