module.exports = {
  anvilVersion: '1.7.1',
  backendRevision: '47aab836f81e74a2ddb019b523b026da2882c07c',
  deploymentSourceSha256:
    '6005a2338c34e6dc5a2958b26effc98272a3dbc5919019785a581c57da905b7f',
  // SHA-256 of each reviewed decoded CREATE2 payload (salt plus init code).
  deploymentPayloadSha256: {
    entryPoint:
      '1b16646c031afcc38a589102a61eba681c9371805edee2469ce625fb5dd161d2',
    accountImplementation:
      'd2c5ff4dec01fccda56520a9b4432d0ab0e7a5d0345ec2b23d3373c5adc18fb6',
    ecdsaValidator:
      '11ab5b0445f9adb9d5f132a41d944b7422c1b3aceae1adbf49da35f98dfda56e',
    p256WebAuthnValidator:
      'bf90e0a7e5c792611d30a070e53e2f8ddb994370fb221399925495f3c36fd578',
    slhDsaVerifier:
      '812d664ac5e179e69cb88b21be444a4eee15c3ce1c00c57f67fbde6ce0185929',
    slhDsaValidator:
      '4fbe40ab761d35825b58905f4579520c8b407c7aefd507bb359c83374b94320f',
    compositeValidator:
      '0705446e65d5a5671cd269e8adce59f779096ea8d51ae36395d20a3f244a6741',
    guardianRecoveryModule:
      '65a63d66d4d0eac604ed58ee65a6392437b4ed4ac91777f92695b425988d26a1',
    factory: 'f34134ea0d8e74d80f8bac0502e2eaa3e7eb69b67d474c54e452543826163c40',
    multicall3:
      '3d41e20ca9670078200144cf76b1136e8cf90c2062546afea4cc8d7eb7f431b2',
  },
};
