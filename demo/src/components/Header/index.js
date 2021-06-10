import { useEffect } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";

import logo from "../../images/logo.svg";
import { elementEventHandler } from "../../utils/elementEventHandler";

const Header = () => {
  const accountData = useSelector((state) => state.connectedAccountData);
  const controller = useSelector((state) => state.controller);
  const isInstalled = useSelector((state) => state.isInstalled);

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
    })(mobilemenu);

    // remove events when component is unmounted
    return () =>
      dropdown.forEach(
        elementEventHandler(["click", "touchstart"], "open", "remove")
      );
  }, []);

  return (
    <header>
      <nav>
        <div className="mobilemenu">
          <Link to="/" className="openmenu">
            <i className="icon-menu"></i>
          </Link>
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
