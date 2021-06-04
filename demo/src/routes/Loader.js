import { useEffect, useState } from "react";
import { useStore } from "react-redux";
import setupState from "../utils/setupState";

export default function Loader({ loading }) {
  const store = useStore();
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    window.onload = function () {
      setupState(store).then((isInstalled) => {
        loading(!isInstalled);
        // !isInstalled && setIsLoading(!isLoading);
      });
    };
  }, []);

  return (
    <div className="loader-container">
      {/* {!isLoading ? <p>Install the Wallet</p> : <div className="loader"></div>} */}
      <p>Install the Wallet</p>
    </div>
  );
}
