import { useSelector } from "react-redux";
import { Link } from "react-router-dom";

import logo from "../../assets/images/logosys.svg";
import { buttons } from "./../../data";

// peace uncle grit essence stuff angle cruise annual fury letter snack globe

const Header = () => {
  const accountData = useSelector((state) => state.connectedAccountData);
  const controller = useSelector((state) => state.controller);
  const isInstalled = useSelector((state) => state.isInstalled);

  const handleMessageExtension = async () => {
    controller
      ? await controller.connectWallet()
      : await window.ConnectionsController.connectWallet();
  };

  const RenderButtons = () => {
    return buttons.map((item) => {
      return (
        <Link key={item.route} className="button" to={item.route}>
          {item.title}
        </Link>
      );
    });
  };

  const truncate = (str) => {
    return str.substr(0, 5) + "..." + str.substr(-5);
  };

  return (
    <nav className="navbar navbar-expand-lg navbar-light static-top">
      <div className="container">
        <a className="navbar-brand" href="https://syscoin.org/">
          <img src={logo} alt="logo" className="header__logo" />
        </a>

        <Link className="button" to="/">
          Home
        </Link>

        <RenderButtons />

        <div className="collapse navbar-collapse" id="navbarResponsive">
          <ul className="navbar-nav ml-auto">
            <button
              title={accountData.connectedAccountAddress}
              className="button"
              onClick={handleMessageExtension}
              disabled={!isInstalled}
            >
              {accountData.connectedAccountAddress === ""
                ? "Connect to Syscoin Wallet"
                : truncate(accountData.connectedAccountAddress)}
            </button>
          </ul>
        </div>
      </div>
    </nav>
  );
};

export default Header;
