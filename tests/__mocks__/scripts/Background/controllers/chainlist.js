module.exports = {
  __esModule: true,
  default: {
    getInstance: () => ({
      getChainById: jest.fn().mockResolvedValue(null),
      initializeChainList: jest.fn().mockResolvedValue(undefined),
    }),
  },
};
