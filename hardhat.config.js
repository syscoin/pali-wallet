/** @type import('hardhat/config').HardhatUserConfig */
// eslint-disable-next-line
require('@nomiclabs/hardhat-ethers');

module.exports = {
  solidity: '0.8.18',
  logging: {
    // Customize the logging options
    // Available options: 'none', 'error', 'warn', 'info', 'debug', 'trace'
    level: 'debug',
    outputFile: 'hardhat.log', // Specify the file to which logs will be written
  },
};
