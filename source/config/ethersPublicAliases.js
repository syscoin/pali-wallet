/* eslint-disable @typescript-eslint/no-var-requires */
const { dirname, resolve } = require('path');

// CommonJS SDK callers and Pali's imports must share the same ethers objects.
// Resolve only the package's declared public requests; its own browser mappings
// still select browser crypto, transports and wordlists inside these modules.
const ethersRoot = dirname(dirname(require.resolve('ethers')));
const { exports: publicExports } = require(resolve(ethersRoot, 'package.json'));

module.exports = Object.fromEntries(
  Object.entries(publicExports).map(([request, entry]) => {
    if (
      (request !== '.' && !/^\.\/[a-z]+$/.test(request)) ||
      typeof entry.import !== 'string' ||
      !entry.import.startsWith('./lib.esm/')
    ) {
      throw new Error(`Unsupported ethers public export: ${request}`);
    }
    return [
      `ethers${request === '.' ? '' : request.slice(1)}$`,
      resolve(ethersRoot, entry.import),
    ];
  })
);
