// Test script to verify wallet reconnection after service worker restart
// Run this in the browser console on a page where Pali is connected

(async function testWalletReconnection() {
  console.log('🧪 Starting wallet reconnection test...');

  // Helper to call eth_accounts
  async function callEthAccounts() {
    try {
      const accounts = await window.ethereum.request({
        method: 'eth_accounts',
      });
      console.log('✅ eth_accounts successful:', accounts);
      return { success: true, accounts };
    } catch (error) {
      console.error('❌ eth_accounts failed:', error);
      return { success: false, error };
    }
  }

  // Test 1: Initial call should work
  console.log('\n📋 Test 1: Initial eth_accounts call');
  const result1 = await callEthAccounts();

  if (!result1.success) {
    console.log(
      '⚠️  Initial call failed. Make sure wallet is connected first.'
    );
    return;
  }

  // Test 2: Wait for service worker to potentially terminate (2 minutes)
  console.log('\n📋 Test 2: Waiting 2 minutes for service worker timeout...');
  console.log('⏳ Please wait, do not interact with the wallet...');

  await new Promise((resolve) => setTimeout(resolve, 2 * 60 * 1000));

  // Test 3: Call should work even after timeout (with retry logic)
  console.log('\n📋 Test 3: eth_accounts call after timeout');
  const result2 = await callEthAccounts();

  if (result2.success) {
    console.log('✅ SUCCESS: Wallet reconnected automatically!');
  } else {
    console.log('❌ FAIL: Wallet did not reconnect. Error:', result2.error);
  }

  // Test 4: Rapid successive calls
  console.log('\n📋 Test 4: Testing rapid successive calls...');
  for (let i = 0; i < 5; i++) {
    console.log(`  Call ${i + 1}:`);
    const result = await callEthAccounts();
    if (!result.success) {
      console.log(`  ❌ Call ${i + 1} failed`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log('\n🏁 Test complete!');
})();
