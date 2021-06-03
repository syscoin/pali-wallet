import { useEffect } from "react";
import { useStore } from "react-redux";
import setupState from "../utils/setupState";

export default function Loader({ loading }) {
  const store = useStore();

  useEffect(() => {
    setupState(store).then((isInstalled) => {
      loading(!isInstalled);
    });
  }, []);

  return <p>Install the Wallet</p>;
}
