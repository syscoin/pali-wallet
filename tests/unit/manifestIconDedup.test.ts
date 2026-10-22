import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MV2_OPTIONS, MV3_OPTIONS } = require('../../source/config/consts');

it('uses identical icon bytes for the deduplicated manifest entries', () => {
  const assets = path.resolve(__dirname, '../../source/assets/all_assets');
  const canonical = 'assets/all_assets/favicon-32.png';
  for (const size of [16, 32, 48, 128]) {
    expect(fs.readFileSync(path.join(assets, `favicon-${size}.png`))).toEqual(
      fs.readFileSync(path.join(assets, 'favicon-32.png'))
    );
    for (const options of [MV2_OPTIONS, MV3_OPTIONS]) {
      expect(options.icons[size]).toBe(canonical);
      const action = options.action || options.browser_action;
      expect(action.default_icon[size]).toBe(canonical);
    }
  }
  for (const options of [MV2_OPTIONS, MV3_OPTIONS]) {
    const resources = options.web_accessible_resources.flatMap(
      (entry: string | { resources: string[] }) =>
        typeof entry === 'string' ? [entry] : entry.resources
    );
    expect(resources.filter((entry: string) => entry === canonical)).toEqual([
      canonical,
    ]);
    expect(resources).not.toContain('assets/all_assets/favicon-128.png');
  }
});

it('does not leave runtime references to excluded favicon copies', () => {
  const source = path.resolve(__dirname, '../../source');
  const inspect = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (file !== path.join(source, 'config')) inspect(file);
      } else if (
        /\.(?:ts|tsx|js|jsx|css|html)$/.test(entry.name) &&
        !/\.(?:spec|test)\./.test(entry.name)
      ) {
        const text = fs.readFileSync(file, 'utf8');
        expect({
          file: path.relative(source, file),
          matches: text.match(
            /['"`][^'"`\n]*favicon-(?:16|48|128)\.png(?:\?inline)?['"`]/g
          ),
        }).toEqual({ file: path.relative(source, file), matches: null });
      }
    }
  };
  inspect(source);
});
