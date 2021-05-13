import React from "react";
import logo from "../../assets/images/logosys.svg";

const Header = ({ 
  canConnect,
  handleMessageExtension,
  isInstalled,
  connectedAccountAddress
}) => {
  return (
    <div>
      <nav className="navbar navbar-expand-lg navbar-light static-top">
        <div className="container">
          <a
            className="navbar-brand"
            href="https://syscoin.org/"
          >
            <img
              src={logo}
              alt="logo"
              className="header__logo"
            />
          </a>

          <a
            className="button"
            href="/"
          >
            Home
          </a>

          <div
            className="collapse navbar-collapse"
            id="navbarResponsive"
          >
            <ul className="navbar-nav ml-auto">
              <button
                className="button"
                onClick={canConnect ? handleMessageExtension : undefined}
                disabled={!isInstalled}>
                {connectedAccountAddress === "" ? "Connect to Syscoin Wallet" : connectedAccountAddress}
              </button>
            </ul>
          </div>
        </div>
      </nav>

      {!isInstalled && (
        <h1 className="app__title">You need to install Syscoin Wallet.</h1>
      )}
    </div>
  )
}

export default Header;