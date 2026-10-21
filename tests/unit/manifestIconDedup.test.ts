import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MV2_OPTIONS, MV3_OPTIONS } = require('../../source/config/consts');

it('uses identical icon bytes for the deduplicated manifest entries', () => {
  const assets = path.resolve(__dirname, '../../source/assets/all_assets');
  for (const size of [16, 48]) {
    expect(fs.readFileSync(path.join(assets, `favicon-${size}.png`))).toEqual(
      fs.readFileSync(path.join(assets, 'favicon-128.png'))
    );
    for (const options of [MV2_OPTIONS, MV3_OPTIONS]) {
      expect(options.icons[size]).toBe(options.icons[128]);
      const action = options.action || options.browser_action;
      expect(action.default_icon[size]).toBe(action.default_icon[128]);
    }
  }
});
