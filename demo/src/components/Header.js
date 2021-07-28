import { useEffect } from "react";
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
    const links = document.querySelectorAll("ul > li > a:not(.dropdown)");

    // menu open submenu
    dropdown.forEach(elementEventHandler(["click"], "open"));

    // mobile menu open/close
    elementEventHandler(["click"], "open", function () {
      desktopmenu.classList.toggle("open");
      document.querySelector("body").classList.toggle("no-scroll");
    })(mobilemenu);

    if(window.innerWidth <= 900) {
      links.forEach(
        (link) => (link.onclick = () => desktopmenu.classList.toggle("open"))
      );
    }

    window.addEventListener("resize", (e) => {
      if(window.innerWidth <= 900) {
        if (Boolean(links[0].onclick)) return;

        links.forEach(
          (link) => (link.onclick = () => desktopmenu.classList.toggle("open"))
        );
      } else if(window.innerWidth > 900) {
        if (Boolean(links[0].onclick) === false) return;
        
        links.forEach(
          (link) => (link.onclick = undefined)
        );
      }
      
    })

    // remove events when component is unmounted
    return () =>
      dropdown.forEach(
        elementEventHandler(["click", "touchstart"], "open", "remove")
      );
  }, []);


  const truncate = (str) => {
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
                <Link to="/" className="active">
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
