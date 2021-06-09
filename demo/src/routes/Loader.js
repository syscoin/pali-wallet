import { useEffect } from "react";
import { useStore } from "react-redux";

import setupState from "../utils/setupState";

export default function Loader({ loading }) {
  const store = useStore();

  useEffect(() => {
    window.onload = function () {
      setupState(store).then((isInstalled) => {
        loading(!isInstalled);
      });
    };
  }, []);

  return (
    <div className="loader-container">
      <p>Install the Wallet</p>
    </div>
  );
}
