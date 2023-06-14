const fs = require('fs');
const path = require('path');
const browserify = require('browserify');
const browserPack = require('browser-pack');
const { groupBySize } = require('bify-module-groups');
const pump = require('pump');
const fsExtra = require('fs-extra');
const rimraf = require('rimraf');

class BreakBundlesPlugin {
  apply(compiler) {
    compiler.hooks.emit.tapAsync(
      'BreakBundlesPlugin',
      (compilation, callback) => {
        const outputPath = compilation.options.output.path;
        const jsFolderPath = path.join(outputPath, 'js');
        const bundleFiles = fs
          .readdirSync(jsFolderPath)
          .filter((file) => file.endsWith('bundle.js'));

        bundleFiles.forEach((file) => {
          const mainFilePath = path.join(jsFolderPath, file);
          const mainFileName = path.basename(file, '.bundle.js');
          const fileSize = fs.statSync(mainFilePath).size;

          if (fileSize > 4 * 1024 * 1024) {
            const mainFileOutputDir = path.join(jsFolderPath, mainFileName);

            // Remove the directory if it exists
            if (fs.existsSync(mainFileOutputDir)) {
              rimraf.sync(mainFileOutputDir);
            }

            // Create the directory
            fsExtra.ensureDirSync(mainFileOutputDir);

            const mainFileOutputPath = path.join(mainFileOutputDir, file);

            const bundler = browserify([mainFilePath]).plugin(groupBySize, {
              sizeLimit: 4 * 1024 * 1024,
            });

            pump(
              bundler.bundle(),
              browserPack({ raw: true }),
              fs.createWriteStream(mainFileOutputPath),
              (err) => {
                if (err) {
                  console.error('Error splitting bundles:', err);
                }
              }
            );
          }
        });

        callback();
      }
    );
  }
}

module.exports = BreakBundlesPlugin;
