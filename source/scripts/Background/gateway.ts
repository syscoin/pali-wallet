import store from 'state/store';
import axios from 'axios';

// This will be called only by the gateway
const checkForSyscoinJSLibNetwork = async ({ blockbookURL }) => {
  const response = await axios.get(`${blockbookURL}/api/v2`);
  const { coin } = response.data.blockbook;

  if (response && coin) {
    if (coin === 'Syscoin' || coin === 'Syscoin Testnet') {
      return true;
    }

    return false;
  }
};

// This will be called only by the gateway
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const fetchState = async () => {
  const { blockbookURL } = store.getState().wallet;

  const isSyscoinNetwork = await checkForSyscoinJSLibNetwork({ blockbookURL });

  // Maybe a switch case here would be better, it would be more readable (this will serve for knowing if its BTC, LITECOIN,SYS and etc)
  if (isSyscoinNetwork) {
    return 'sys';
  }

  return 'other';
};

export const rpcLibSwitch = async () => {
  const isSyscoinJS = true;
  // get if the user is connected at a web3 compatible chain or syscoinjslib compatible chain

  if (isSyscoinJS) {
    // call fetchState to know which network is connected
    console.log('fetching the network');
    console.log(
      'Delete the older syscoinjslib being used by the syscoin controllers'
    );
    console.log('Initialise the new syscoinjslib object');
    // this flow might lead to the user having to input his password again changing networks would be nice if we could change networks of the same lib without asking for password to get seed phrase again
  } else {
    // initialise the web3 object for web3 controllers
    // function to connect on web3 with the proper chain
  }
};

/* const rpcLibRouter = async () => {
  // This is the function to be called by the frontEnd to point the user to the correct controllers
  // Depending on the chain that he is connected the function will go to the correct function
  // maybe a refactor in the states of network so it has more information as a boolean for is web3 or syscoinjslib
  // and naming for sendTransaction , sendSPTTransaction and so on, so here we will have a big switch case routing to the proper controller function
}; */
