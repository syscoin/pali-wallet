import { expect, test } from '@playwright/test';

import { resetVisualScroll } from './scrollReset';

// SYSCOIN: Deterministic DOM-only regression. No extension, wallet, provider,
// seed, balance, on-chain action or screenshot-baseline replacement.
for (const direction of ['ltr', 'rtl'] as const) {
  test(
    'resets nested horizontal and vertical scroll (' + direction + ')',
    async ({ page }) => {
      await page.route('**/*', (route) => route.abort());
      await page.setContent(
        '<style>body{margin:0}#shell{width:200px;height:100px;overflow:hidden}' +
          '#content{width:400px;height:600px}</style>' +
          '<main id="shell" dir="' +
          direction +
          '"><div id="content">Synthetic overflow fixture</div></main>'
      );
      const before = await page.evaluate((dir) => {
        const shell = document.getElementById('shell')!;
        shell.scrollTop = 81;
        shell.scrollLeft = dir === 'rtl' ? -16 : 16;
        return { x: shell.scrollLeft, y: shell.scrollTop };
      }, direction);
      expect(before).toEqual({ x: direction === 'rtl' ? -16 : 16, y: 81 });

      await page.evaluate(resetVisualScroll);

      expect(
        await page.evaluate(() => {
          const shell = document.getElementById('shell')!;
          return { x: shell.scrollLeft, y: shell.scrollTop };
        })
      ).toEqual({ x: 0, y: 0 });
    }
  );
}
