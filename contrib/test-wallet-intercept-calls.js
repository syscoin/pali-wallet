// Paste this into the MetaMask test-dapp console BEFORE clicking the SIWE button
// This will intercept ALL ethereum.request calls

console.log('🔍 Setting up comprehensive MetaMask interceptor...');

// Store original methods
const originalRequest = window.ethereum.request;
const originalSend = window.ethereum.send;
const originalSendAsync = window.ethereum.sendAsync;

// Create a deep interceptor
const interceptor = {
  loggedCalls: [],

  intercept: async function (method, args) {
    const callInfo = {
      timestamp: new Date().toISOString(),
      method: method,
      args: args,
      stack: new Error().stack,
    };

    console.group(`🎯 Ethereum Request: ${method}`);
    console.log('Method:', method);
    console.log('Arguments:', JSON.stringify(args, null, 2));

    // Special handling for signing methods
    if (
      method === 'personal_sign' ||
      method === 'eth_sign' ||
      method === 'eth_signTypedData_v4'
    ) {
      console.log('🔐 SIGNING METHOD DETECTED!');

      if (args.params && args.params[0]) {
        const messageHex = args.params[0];
        console.log('Raw hex message:', messageHex);

        try {
          const decoded = messageHex.startsWith('0x')
            ? Buffer.from(messageHex.slice(2), 'hex').toString('utf8')
            : Buffer.from(messageHex, 'hex').toString('utf8');

          console.log('📝 Decoded message:');
          console.log(decoded);

          // Check if it's SIWE
          if (
            decoded.includes('wants you to sign in with your Ethereum account:')
          ) {
            console.log('✅ SIWE MESSAGE CONFIRMED!');

            // Copy to clipboard
            navigator.clipboard.writeText(decoded).then(() => {
              console.log('📋 Message copied to clipboard!');
            });

            // Analyze the message
            console.log('📊 SIWE Analysis:');
            const lines = decoded.split('\n');
            lines.forEach((line, i) => {
              console.log(`  Line ${i + 1}: "${line}"`);
            });
          }
        } catch (e) {
          console.error('Decode error:', e);
        }
      }
    }

    // Check for any SIWE-specific methods
    if (
      method.toLowerCase().includes('siwe') ||
      method.toLowerCase().includes('signin')
    ) {
      console.log('⚠️ POSSIBLE SIWE-SPECIFIC METHOD!');
    }

    console.log('Call stack:', callInfo.stack);
    console.groupEnd();

    // Store the call
    this.loggedCalls.push(callInfo);

    // Call the original method
    return args;
  },
};

// Override ethereum.request
window.ethereum.request = async function (args) {
  const result = await originalRequest.apply(this, arguments);
  console.log(`📤 Result for ${args.method}:`, result);
  return result;
};

// Override ethereum.send (legacy)
if (window.ethereum.send) {
  window.ethereum.send = async function (method, params) {
    console.log('🔄 Legacy send() called:', method, params);
    await interceptor.intercept(method, { method, params });
    return originalSend.apply(this, arguments);
  };
}

// Override ethereum.sendAsync (legacy)
if (window.ethereum.sendAsync) {
  window.ethereum.sendAsync = function (args) {
    console.log('🔄 Legacy sendAsync() called:', args);
    interceptor.intercept(args.method, args);
    return originalSendAsync.apply(this, arguments);
  };
}

// Also intercept any provider.request calls
if (window.provider && window.provider !== window.ethereum) {
  const originalProviderRequest = window.provider.request;
  window.provider.request = async function (args) {
    console.log('🌐 Provider request:', args);
    await interceptor.intercept(args.method, args);
    return originalProviderRequest.apply(this, arguments);
  };
}

console.log('✅ Interceptor installed! Now click the SIWE button.');
console.log('📌 To see all logged calls: interceptor.loggedCalls');

// Expose the interceptor globally
window.ethereumInterceptor = interceptor;
