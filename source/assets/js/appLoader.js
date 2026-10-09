// This runs before the bundles, so failed chunk loads still have a recovery UI.
const loaderTimeout = setTimeout(function () {
  if (document.body.classList.contains('app-loaded')) return;
  const loader = document.getElementById('initial-loader');
  if (!loader) return;

  const message = document.createElement('p');
  message.textContent = 'Your wallet is taking longer to open.';
  message.setAttribute('role', 'status');
  message.style.cssText =
    'color:white;font:14px sans-serif;margin:24px 16px 16px;text-align:center';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Reload wallet';
  retry.style.cssText =
    'background:#4da2cf;color:#061120;border:0;border-radius:8px;padding:12px 20px;font:600 14px sans-serif;cursor:pointer';
  retry.addEventListener('click', function () {
    window.location.reload();
  });
  loader.appendChild(message);
  loader.appendChild(retry);
}, Math.max(0, 1800 - performance.now()));

window.addEventListener('pali-app-ready', function () {
  clearTimeout(loaderTimeout);
  document.body.classList.add('app-loaded');
});
