// Debug script to check Chrome storage contents
// This can be run in the browser console on the extension page

chrome.storage.local.get(null, (items) => {
  console.log('=== ALL CHROME STORAGE ITEMS ===');
  Object.keys(items).forEach((key) => {
    if (key.startsWith('state') || key.startsWith('sysweb3')) {
      console.log(`${key}:`, items[key]);

      // Try to parse if it's JSON
      if (typeof items[key] === 'string') {
        try {
          const parsed = JSON.parse(items[key]);
          console.log(`${key} (parsed):`, parsed);
        } catch (e) {
          console.log(`${key} is not JSON`);
        }
      }
    }
  });
});
