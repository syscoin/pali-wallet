import { expect, type Page, type TestInfo } from '@playwright/test';

import en from '../../source/assets/locales/en.json';

// Run against a genuine sys_sign approval; no application state is replaced.
export async function inspectPsbtReviewHeader(page: Page, info: TestInfo) {
  const original = page.viewportSize();
  const title = page.getByText(en.send.transactionDetails, { exact: true });
  const show = page.getByRole('button', {
    name: new RegExp(`(?:${en.send.showDetails}|${en.send.hideDetails})$`),
  });
  const copy = page.getByRole('button', {
    name: en.transactions.copyDetails,
    exact: true,
  });
  for (const width of [400, 320]) {
    await page.setViewportSize({ width, height: width === 400 ? 620 : 360 });
    await expect(title).toBeVisible();
    for (let attempt = 0; attempt < 12; attempt++) {
      const point = await title.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        let owner = element.parentElement;
        while (
          owner &&
          !(
            owner.scrollHeight > owner.clientHeight + 2 &&
            /auto|scroll/.test(getComputedStyle(owner).overflowY)
          )
        )
          owner = owner.parentElement;
        const area = (
          owner || document.documentElement
        ).getBoundingClientRect();
        const top = Math.max(0, area.top);
        const bottom = Math.min(innerHeight - 85, area.bottom);
        if (rect.top >= top + 8 && rect.bottom + 48 <= bottom) return null;
        return {
          x: Math.max(8, area.left + 8),
          y: Math.min(bottom - 8, top + 40),
          dy: rect.top < top + 8 ? -100 : 100,
        };
      });
      if (!point) break;
      await page.mouse.move(point.x, point.y);
      await page.mouse.wheel(0, point.dy);
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      );
    }
    await expect(title).toBeInViewport({ ratio: 1 });
    const words = await title.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const parts: {
        left: number;
        lines: number;
        right: number;
        word: string;
      }[] = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = node.textContent || '';
        for (const match of text.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index!);
          range.setEnd(node, match.index! + match[0].length);
          const rects = [...range.getClientRects()];
          parts.push({
            word: match[0],
            lines: new Set(rects.map((r) => Math.round(r.top))).size,
            left: Math.min(...rects.map((r) => r.left)),
            right: Math.max(...rects.map((r) => r.right)),
          });
        }
      }
      return parts;
    });
    await page.mouse.move(0, 0);
    await info.attach(`psbt-review-header-${width}`, {
      body: await page.screenshot({ animations: 'disabled' }),
      contentType: 'image/png',
    });
    await info.attach(`psbt-review-header-${width}-words`, {
      body: JSON.stringify(words),
      contentType: 'application/json',
    });
    expect(words.map((word) => word.word)).toEqual(
      en.send.transactionDetails.split(/\s+/)
    );
    expect(
      words.every(
        (word) => word.lines === 1 && word.left >= 0 && word.right <= width
      )
    ).toBe(true);
    for (const control of [show, copy]) {
      await expect(control).toBeInViewport({ ratio: 1 });
      expect(
        await control.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const target = document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
          );
          return target === element || (!!target && element.contains(target));
        })
      ).toBe(true);
    }
    // Exercise both real controls without submitting the PSBT.
    const before = await show.innerText();
    await show.click();
    await expect(show).not.toHaveText(before);
    await show.click();
    await expect(show).toHaveText(before);
    for (let attempt = 0; attempt < 40; attempt++) {
      if (await copy.evaluate((element) => element === document.activeElement))
        break;
      await page.keyboard.press('Tab');
    }
    await expect(copy).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText(en.transactions.transactionJsonCopied, { exact: true })
    ).toBeVisible();
  }
  if (original) await page.setViewportSize(original);
}
