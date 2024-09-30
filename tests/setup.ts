import 'dotenv/config';

import { chromium } from '@playwright/test';
import path from 'path';

export default async function setup() {
  const pathToExtension = path.join(__dirname, '../build/chrome');
  const args = [
    `--disable-extensions-except=${pathToExtension}`,
    `--load-extension=${pathToExtension}`,
  ];

  if (process.env.HEADLESS === 'true') {
    args.unshift(`--headless=new`);
  }

  const context = await chromium.launchPersistentContext('user-data', {
    headless: false,
    args,
  });

  let [background] = context.serviceWorkers();
  if (!background) background = await context.waitForEvent('serviceworker');

  const extensionId = background.url().split('/')[2];
  const page = context.pages()[0];

  return { context, extensionId, page };
}
