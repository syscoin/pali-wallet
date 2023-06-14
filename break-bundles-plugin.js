import fs from 'fs';
import path from 'path';

class BreakBundlesPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tapAsync(
      'BreakBundlesPlugin',
      (compilation, callback) => {
        const outputPath = compilation.options.output.path;
        const jsFolderPath = path.join(outputPath, 'js');

        const bundleFiles = fs
          .readdirSync(jsFolderPath)
          .filter((file) => file.endsWith('bundle.js'));

        bundleFiles.forEach((file) => {
          const mainFilePath = path.join(jsFolderPath, file);
          const content = fs.readFileSync(mainFilePath, 'utf8');

          if (content.length > 4 * 1024 * 1024) {
            // 4MB in bytes
            const numChunks = Math.ceil(content.length / (4 * 1024 * 1024));

            const mainFileName = path.basename(file, '.bundle.js');
            const subfolderPath = path.join(jsFolderPath, mainFileName);
            fs.mkdirSync(subfolderPath);

            for (let i = 0; i < numChunks; i++) {
              const chunkContent = content.slice(
                i * (4 * 1024 * 1024),
                (i + 1) * (4 * 1024 * 1024)
              );
              const chunkFilename = `${mainFileName}_${i + 1}.bundle.js`;

              fs.writeFileSync(
                path.join(subfolderPath, chunkFilename),
                chunkContent
              );
            }

            fs.unlinkSync(mainFilePath);
          }
        });

        callback();
      }
    );
  }
}

module.exports = BreakBundlesPlugin;
