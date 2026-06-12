// Composes the raw captures from capture.spec.ts into the branded 1408x832
// cards used by the docs portal, and converts the webm screen recordings to
// mp4. Outputs land in out/cards and out/mp4 for review before being copied
// into docs/portal/static.
//
// Run with: yarn docs:media:compose
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const RAW_DIR = path.join(__dirname, 'out', 'raw');
const LEGACY_DIR = path.join(__dirname, 'legacy');
const CARDS_DIR = path.join(__dirname, 'out', 'cards');
const VIDEO_DIR = path.join(__dirname, 'out', 'video');
const MP4_DIR = path.join(__dirname, 'out', 'mp4');
const LOGO_SVG = fs.readFileSync(
  path.join(repoRoot, 'docs/portal/static/img/logo.svg'),
  'utf8'
);

// Some states cannot be recaptured headless (the macOS Touch ID sheet has no
// UI under a virtual authenticator; the PSBT review needs mainnet UTXO
// funds). Their inner screenshots are cropped out of the preserved legacy
// assets in ./legacy and re-wrapped in the current card style.
const LEGACY_CROPS = [
  {
    src: 'browser-passkey-assert.png',
    out: 'browser-passkey-assert-inner.png',
    // Inner dialog region of the old 1408x832 card.
    crop: '630:489:654:184',
  },
  {
    src: 'browser-passkey-create.png',
    out: 'browser-passkey-create-inner.png',
    crop: '630:489:654:184',
  },
];

// Card metadata. `raw` names a file in out/raw; `kind` picks the frame:
//   phone   - 400x620 wallet capture in a device frame
//   browser - wide dapp capture in a browser-chrome frame
//   sheet   - OS/browser dialog capture in a plain frame
//   poster  - phone frame plus a play overlay (video preview image)
const CARDS = [
  {
    out: 'install-unlocked-wallet.png',
    raw: 'home-unlocked.png',
    kind: 'phone',
    chip: 'EVM \u2022 zkTanenbaum',
    title: 'Unlocked\nWallet',
    subtitle: 'Installed and ready',
    caption: 'The home screen shows balance, actions, and activity.',
  },
  {
    out: 'connect-dapp-popup.png',
    raw: 'connect-dapp-popup.png',
    kind: 'phone',
    chip: 'EIP-1193',
    title: 'Connect\nAccount',
    subtitle: 'Dapp access request',
    caption: 'Users choose which account the site can see.',
  },
  {
    out: 'eip6963-pali-provider.png',
    raw: 'eip6963-pali-provider.png',
    kind: 'browser',
    chip: 'EIP-6963',
    title: 'Provider\nDiscovery',
    subtitle: 'Multi-wallet picker',
    caption: 'Dapps detect Pali next to every other installed wallet.',
  },
  {
    out: 'evm-send-review.png',
    raw: 'evm-send-review.png',
    kind: 'phone',
    chip: 'EVM',
    title: 'EVM Send\nReview',
    subtitle: 'Transaction confirmation',
    caption: 'Pali shows amount, fees, route, and approval controls.',
  },
  {
    out: 'typed-data-review.png',
    raw: 'typed-data-review.png',
    kind: 'phone',
    chip: 'EIP-712',
    title: 'Typed Data\nReview',
    subtitle: 'Structured signing request',
    caption: 'Origin, account, and decoded fields before approval.',
  },
  {
    out: 'send-calls-smart-account-batch.png',
    raw: 'send-calls-smart-account-batch.png',
    kind: 'phone',
    chip: 'EIP-5792',
    title: 'Smart Account\nBatch',
    subtitle: 'wallet_sendCalls review',
    caption: 'Decoded calls execute atomically under one approval.',
  },
  {
    out: 'settings-smart-account-create.png',
    raw: 'settings-smart-account-create.png',
    kind: 'phone',
    chip: 'ERC-4337',
    title: 'Smart Account\nSetup',
    subtitle: 'Create from wallet settings',
    caption: 'Create smart accounts without a dapp request.',
  },
  {
    out: 'settings-smart-account-policy.png',
    raw: 'settings-smart-account-policy.png',
    kind: 'phone',
    chip: 'ERC-7579',
    title: 'Smart Account\nPolicy',
    subtitle: 'Validators and recovery',
    caption: 'Validator, recovery, and module state stay visible.',
  },
  {
    out: 'settings-smart-account-recover.png',
    raw: 'settings-smart-account-recover.png',
    kind: 'phone',
    chip: 'Guardian',
    title: 'Account\nRecovery',
    subtitle: 'Guardian recovery',
    caption: 'Recover access by replacing the active validator.',
  },
  {
    out: 'utxo-connect-popup.png',
    raw: 'utxo-connect-popup.png',
    kind: 'phone',
    chip: 'UTXO \u2022 Syscoin',
    title: 'UTXO\nConnect',
    subtitle: 'Syscoin account access',
    caption: 'Users choose which UTXO account the site can see.',
  },
  {
    out: 'browser-passkey-create.png',
    raw: 'browser-passkey-create-inner.png',
    kind: 'sheet',
    chip: 'WebAuthn',
    title: 'Passkey\nCreation',
    subtitle: 'OS-level enrollment',
    caption: 'The OS saves the passkey; private keys never leave the device.',
  },
  {
    out: 'browser-passkey-assert.png',
    raw: 'browser-passkey-assert-inner.png',
    kind: 'sheet',
    chip: 'WebAuthn',
    title: 'Passkey\nAssertion',
    subtitle: 'Browser WebAuthn prompt',
    caption: 'Touch ID confirms the prepared wallet action.',
  },
  {
    out: 'smart-account-create-disabled.png',
    raw: 'smart-account-prepare-popup.png',
    kind: 'phone',
    chip: 'ERC-4337',
    title: 'Create Smart\nAccount',
    subtitle: 'Dapp-initiated setup',
    caption: 'Review the requesting site, network, and sign-in method first.',
  },
  {
    out: 'smart-account-create-required.png',
    raw: 'smart-account-prepare-details.png',
    kind: 'phone',
    chip: 'Passkeys',
    title: 'Request\nDetails',
    subtitle: 'Full disclosure',
    caption: 'Validator modules and policy stay visible before approval.',
  },
  {
    out: 'smart-account-dapp-onboarding-video.png',
    raw: 'smart-account-prepare-popup.png',
    kind: 'poster',
    chip: 'Passkeys',
    title: 'Smart Account\nOnboarding',
    subtitle: 'Video preview',
    caption: 'Dapp request to passkey validator, end to end.',
  },
  {
    out: 'smart-account-batch-sendcalls-video.png',
    raw: 'send-calls-smart-account-batch.png',
    kind: 'poster',
    chip: 'EIP-5792',
    title: 'Batch Calls\nIn Action',
    subtitle: 'Video preview',
    caption: 'One approval, one atomic bundle, live on testnet.',
  },
];

const cardHtml = ({ caption, chip, imageData, kind, subtitle, title }) => {
  const isBrowser = kind === 'browser';
  const isSheet = kind === 'sheet';
  const isPoster = kind === 'poster';
  const titleHtml = title.replace(/\n/g, '<br/>');

  const screen = isBrowser
    ? `
      <div class="browser">
        <div class="browser-bar">
          <span class="dot red"></span><span class="dot yellow"></span><span class="dot green"></span>
          <span class="urlbar">&#128274;&nbsp; demo.paliwallet.com</span>
        </div>
        <img class="browser-shot" src="${imageData}" alt="" />
      </div>`
    : isSheet
      ? `
      <div class="sheet">
        <img class="sheet-shot" src="${imageData}" alt="" />
      </div>`
      : `
      <div class="device">
        <img class="device-shot" src="${imageData}" alt="" />
        ${isPoster ? '<div class="play-overlay"><div class="play"><div class="play-tri"></div></div></div>' : ''}
      </div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 1408px; height: 832px; overflow: hidden; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', Roboto, sans-serif;
    background: #050d1b;
    position: relative;
  }
  .blob { position: absolute; border-radius: 999px; filter: blur(90px); }
  .blob.b1 { width: 620px; height: 620px; right: -160px; top: -260px; background: rgba(47,107,255,0.30); }
  .blob.b2 { width: 480px; height: 480px; left: -180px; bottom: -240px; background: rgba(255,62,145,0.16); }
  .blob.b3 { width: 360px; height: 360px; left: 40%; top: -220px; background: rgba(76,161,207,0.14); }

  .panel {
    position: absolute; inset: 56px;
    border-radius: 32px;
    background:
      linear-gradient(120deg, rgba(255,255,255,0.045), rgba(255,255,255,0.012) 38%),
      #0a1426;
    border: 1px solid rgba(125, 165, 255, 0.22);
    box-shadow: 0 40px 120px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255,255,255,0.06);
    display: flex; align-items: center;
    overflow: hidden;
  }
  .panel::before {
    content: ''; position: absolute; inset: 0;
    background:
      radial-gradient(560px 420px at 86% 18%, rgba(47,107,255,0.16), transparent 65%),
      radial-gradient(420px 380px at 76% 92%, rgba(255,62,145,0.10), transparent 65%);
    pointer-events: none;
  }

  .copy { width: 56%; padding: 0 48px 0 72px; position: relative; }
  .brandrow { display: flex; align-items: center; gap: 18px; margin-bottom: 44px; }
  .brandrow svg { width: 72px; height: 72px; border-radius: 20px; box-shadow: 0 14px 34px rgba(47,107,255,0.45); }
  .wordmark { font-size: 26px; font-weight: 600; letter-spacing: 0.01em; color: #9db8e8; }
  .chip {
    display: inline-flex; align-items: center;
    margin-bottom: 22px; padding: 7px 16px;
    border-radius: 999px; border: 1px solid rgba(76,161,207,0.45);
    background: rgba(76,161,207,0.12);
    color: #7cc6ef; font-size: 15px; font-weight: 700;
    letter-spacing: 0.14em; text-transform: uppercase;
  }
  h1 { color: #f6f8fd; font-size: 64px; line-height: 1.06; font-weight: 800; letter-spacing: -0.015em; }
  .subtitle {
    margin-top: 20px; font-size: 28px; font-weight: 600;
    background: linear-gradient(90deg, #6f9bff, #ff3e91);
    -webkit-background-clip: text; background-clip: text; color: transparent;
    width: fit-content;
  }
  .caption { margin-top: 26px; font-size: 19px; line-height: 1.5; color: #8d9cb5; max-width: 480px; }

  .stage { width: 44%; height: 100%; position: relative; display: flex; align-items: center; justify-content: center; }

  .device {
    position: relative; border-radius: 30px; padding: 10px;
    background: linear-gradient(160deg, rgba(125,165,255,0.5), rgba(255,62,145,0.35));
    box-shadow: 0 34px 90px rgba(0,0,0,0.65), 0 0 80px rgba(47,107,255,0.18);
  }
  .device::after {
    content: ''; position: absolute; inset: 10px; border-radius: 22px;
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); pointer-events: none;
  }
  .device-shot { display: block; width: 384px; height: auto; border-radius: 22px; }

  .browser {
    border-radius: 18px; overflow: hidden;
    border: 1px solid rgba(125,165,255,0.35);
    box-shadow: 0 34px 90px rgba(0,0,0,0.65), 0 0 80px rgba(47,107,255,0.15);
    background: #0d1525;
  }
  .browser-bar {
    height: 44px; display: flex; align-items: center; gap: 8px;
    padding: 0 16px; background: #101b30;
    border-bottom: 1px solid rgba(255,255,255,0.07);
  }
  .dot { width: 12px; height: 12px; border-radius: 999px; }
  .dot.red { background: #ff5f57; } .dot.yellow { background: #febc2e; } .dot.green { background: #28c840; }
  .urlbar {
    margin-left: 14px; flex: 0 0 auto;
    font-size: 13px; color: #93a4bd;
    background: rgba(255,255,255,0.06); border-radius: 999px;
    padding: 6px 18px;
  }
  .browser-shot { display: block; width: 540px; height: auto; }

  .sheet {
    border-radius: 20px; overflow: hidden;
    border: 1px solid rgba(125,165,255,0.35);
    box-shadow: 0 34px 90px rgba(0,0,0,0.65), 0 0 80px rgba(47,107,255,0.15);
    background: #0d1525;
  }
  .sheet-shot { display: block; width: 520px; height: auto; }

  .play-overlay {
    position: absolute; inset: 10px; border-radius: 22px;
    background: rgba(5, 13, 27, 0.35);
    display: flex; align-items: center; justify-content: center;
  }
  .play {
    width: 96px; height: 96px; border-radius: 999px;
    background: linear-gradient(135deg, #2f6bff, #ff3e91);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 18px 50px rgba(0,0,0,0.55), 0 0 0 10px rgba(255,255,255,0.08);
  }
  .play-tri {
    width: 0; height: 0; margin-left: 8px;
    border-style: solid; border-width: 19px 0 19px 32px;
    border-color: transparent transparent transparent #ffffff;
  }
</style></head>
<body>
  <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
  <div class="panel">
    <div class="copy">
      <div class="brandrow">${LOGO_SVG}<span class="wordmark">Pali Wallet</span></div>
      <div class="chip">${chip}</div>
      <h1>${titleHtml}</h1>
      <div class="subtitle">${subtitle}</div>
      <div class="caption">${caption}</div>
    </div>
    <div class="stage">${screen}</div>
  </div>
</body></html>`;
};

const findFfmpeg = () => {
  if (process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)) {
    return process.env.FFMPEG;
  }
  const candidates = [
    '/tmp/ffm/node_modules/ffmpeg-static/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return 'ffmpeg';
  } catch {
    return null;
  }
};

const main = async () => {
  fs.mkdirSync(CARDS_DIR, { recursive: true });
  fs.mkdirSync(MP4_DIR, { recursive: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });

  // Crop the non-recapturable inner screenshots out of the legacy assets.
  const cropFfmpeg = findFfmpeg();
  for (const legacy of LEGACY_CROPS) {
    const src = path.join(LEGACY_DIR, legacy.src);
    if (!cropFfmpeg || !fs.existsSync(src)) continue;
    execFileSync(cropFfmpeg, [
      '-loglevel',
      'error',
      '-y',
      '-i',
      src,
      '-vf',
      `crop=${legacy.crop}`,
      '-frames:v',
      '1',
      '-update',
      '1',
      path.join(RAW_DIR, legacy.out),
    ]);
  }

  const browser = await chromium.launch();
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { height: 832, width: 1408 },
  });

  const results = { cards: [], missing: [], videos: [] };

  for (const card of CARDS) {
    const rawPath = path.join(RAW_DIR, card.raw);
    if (!fs.existsSync(rawPath)) {
      results.missing.push(card.out);
      continue;
    }
    const imageData = `data:image/png;base64,${fs
      .readFileSync(rawPath)
      .toString('base64')}`;
    await page.setContent(cardHtml({ ...card, imageData }), {
      waitUntil: 'networkidle',
    });
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(CARDS_DIR, card.out) });
    results.cards.push(card.out);
  }
  await browser.close();

  // psbt-sign-review intentionally ships as the raw tall capture: the docs
  // wrap it in their own HTML card (pali-capture-card) with a scrollable
  // preview, so a pre-composed card would nest a card inside a card.
  const psbtFresh = path.join(RAW_DIR, 'psbt-sign-review.png');
  const psbtLegacy = path.join(LEGACY_DIR, 'psbt-sign-review.png');
  const psbtSource = fs.existsSync(psbtFresh) ? psbtFresh : psbtLegacy;
  if (fs.existsSync(psbtSource)) {
    fs.copyFileSync(psbtSource, path.join(CARDS_DIR, 'psbt-sign-review.png'));
    results.cards.push(
      `psbt-sign-review.png (raw passthrough, ${
        psbtSource === psbtFresh ? 'fresh' : 'legacy'
      })`
    );
  } else {
    results.missing.push('psbt-sign-review.png');
  }

  const ffmpeg = findFfmpeg();
  // Per-video action timeline (ms from recording start) written by the
  // capture run. The dapp page and the wallet popup record separately, so a
  // single-window recording can only show one side of the story. We stitch a
  // dapp lead-in + the popup review/sign + a dapp success beat into one clip.
  const marksPath = path.join(__dirname, 'out', 'video-marks.json');
  const videoMarks = fs.existsSync(marksPath)
    ? JSON.parse(fs.readFileSync(marksPath, 'utf8'))
    : {};

  // Shared encode settings so every segment is concat-compatible.
  const encodeArgs = (extraVf = '') => [
    '-c:v',
    'libx264',
    '-preset',
    'slow',
    '-crf',
    '22',
    '-pix_fmt',
    'yuv420p',
    '-r',
    '24',
    '-vf',
    `scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=24${extraVf}`,
    '-movflags',
    '+faststart',
    '-an',
  ];

  // Per-flow playback speed, split between the review/details part (kept slow
  // enough to read) and the action/progress tail. The onboarding popup spends
  // ~18s on the on-chain deploy spinner, so its tail gets a bigger speed-up.
  const POPUP_SPEED = {
    'smart-account-batch-sendcalls': { action: 1.4, review: 1.2 },
    'smart-account-dapp-onboarding': { action: 2.6, review: 1.25 },
  };

  const speedVf = (speed) => `,setpts=${(1 / speed).toFixed(4)}*PTS`;

  const stitchVideo = (base) => {
    const marks = videoMarks[base];
    const dappWebm = path.join(VIDEO_DIR, `${base}__dapp.webm`);
    const popupWebm = path.join(VIDEO_DIR, `${base}__popup.webm`);
    if (!fs.existsSync(dappWebm) || !fs.existsSync(popupWebm) || !marks) {
      return false;
    }
    const tmp = fs.mkdtempSync(path.join(MP4_DIR, `${base}-`));
    // Start after first paint so the clip never opens on the blank white page
    // that precedes the dapp render.
    const readyS = Math.max(0, (marks.ready || 0) / 1000 - 0.25);
    const clickS = (marks.click || 0) / 1000;
    const successS = (marks.success || marks.end || 0) / 1000;
    const speed = POPUP_SPEED[base] || { action: 1.5, review: 1.3 };

    const segments = [];
    const seg = (name) => {
      const p = path.join(tmp, name);
      segments.push(p);
      return p;
    };

    // A: dapp from first paint through the button press (cursor glide +
    // ripple). -ss before -i seeks past the blank pre-render frames.
    execFileSync(ffmpeg, [
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(readyS),
      '-i',
      dappWebm,
      '-t',
      String(Math.max(0.6, clickS + 1.6 - readyS)),
      ...encodeArgs(),
      seg('a.mp4'),
    ]);

    // B: the popup. The confirm/sign button can sit enabled-but-not-ready for
    // ~20-30s while the wallet finishes background readiness checks, which
    // films as a frozen review. When the popup-local marks are present, cut
    // that static gap: keep the review/details, then jump to the press +
    // progress + success. Everything in the popup is sped up for pacing.
    const pDetails = Number(marks.pDetailsDone);
    const pConfirm = Number(marks.pConfirm);
    // Skip the popup's first frames while the wallet UI mounts (blank).
    const popupReadyS = 0.6;
    if (Number.isFinite(pDetails) && Number.isFinite(pConfirm)) {
      execFileSync(ffmpeg, [
        '-loglevel',
        'error',
        '-y',
        '-ss',
        String(popupReadyS),
        '-t',
        String(Math.max(0.6, pDetails / 1000 + 0.8 - popupReadyS)),
        '-i',
        popupWebm,
        ...encodeArgs(speedVf(speed.review)),
        seg('b1.mp4'),
      ]);
      execFileSync(ffmpeg, [
        '-loglevel',
        'error',
        '-y',
        '-ss',
        String(Math.max(0, pConfirm / 1000 - 0.5)),
        '-i',
        popupWebm,
        ...encodeArgs(speedVf(speed.action)),
        seg('b2.mp4'),
      ]);
    } else {
      execFileSync(ffmpeg, [
        '-loglevel',
        'error',
        '-y',
        '-ss',
        String(popupReadyS),
        '-i',
        popupWebm,
        ...encodeArgs(speedVf(speed.review)),
        seg('b.mp4'),
      ]);
    }

    // C: back on the dapp for the green success line.
    execFileSync(ffmpeg, [
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(Math.max(0, successS - 0.4)),
      '-i',
      dappWebm,
      '-t',
      '3.2',
      ...encodeArgs(),
      seg('c.mp4'),
    ]);

    const listFile = path.join(tmp, 'list.txt');
    fs.writeFileSync(
      listFile,
      segments.map((p) => `file '${p}'`).join('\n')
    );
    execFileSync(ffmpeg, [
      '-loglevel',
      'error',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listFile,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      path.join(MP4_DIR, `${base}.mp4`),
    ]);
    fs.rmSync(tmp, { recursive: true, force: true });
    return true;
  };

  const stitchedBases = new Set();
  if (ffmpeg) {
    for (const [base, marks] of Object.entries(videoMarks)) {
      if (marks && marks.stitch) {
        if (stitchVideo(base)) {
          results.videos.push(`${base}.mp4 (stitched dapp+popup)`);
          stitchedBases.add(`${base}__dapp`);
          stitchedBases.add(`${base}__popup`);
        } else {
          results.missing.push(`${base}.mp4 (stitch sources missing)`);
        }
      }
    }
  }

  // Any remaining standalone recordings (non-stitched) convert straight to
  // mp4, skipping the per-segment sources already consumed by stitching.
  const webms = fs.existsSync(VIDEO_DIR)
    ? fs.readdirSync(VIDEO_DIR).filter((file) => file.endsWith('.webm'))
    : [];
  for (const webm of webms) {
    const name = webm.replace(/\.webm$/, '');
    if (stitchedBases.has(name)) continue;
    const mp4 = `${name}.mp4`;
    if (!ffmpeg) {
      results.missing.push(`${mp4} (no ffmpeg found; set $FFMPEG)`);
      continue;
    }
    execFileSync(ffmpeg, [
      '-loglevel',
      'error',
      '-y',
      '-i',
      path.join(VIDEO_DIR, webm),
      ...encodeArgs(),
      path.join(MP4_DIR, mp4),
    ]);
    results.videos.push(mp4);
  }

  console.log(JSON.stringify(results, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
