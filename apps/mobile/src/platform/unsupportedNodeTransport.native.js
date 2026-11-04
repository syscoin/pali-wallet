// Proof-library Node transports are not React Native transports. Any attempt
// to execute them must fail rather than acquire implicit networking authority.
module.exports = new Proxy({}, {
  get(_target, name) {
    if (name === '__esModule') return false;
    if (name === 'then') return undefined;
    return function unavailableNodeTransport() {
      throw new Error('This Node transport is unavailable in the native wallet');
    };
  },
});
