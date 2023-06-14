const fs = require('fs');
const path = require('path');

function generateTemplateContent({ folderName }) {
  const targetBrowser = process.env.TARGET_BROWSER;
  const destPath = path.join(__dirname, 'build');
  const jsFolderPath = path.join(destPath, targetBrowser, 'js', folderName);

  const splitFiles = fs
    .readdirSync(jsFolderPath)
    .filter((file) => file.endsWith('.js'));

  const scriptTags = splitFiles.map((file) => {
    const fileUrl = path.join('js', folderName, file).replace(/\\/g, '/');

    return `<script src="${fileUrl}" type="module" charset="utf-8"></script>`;
  });

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=500" />
        <link rel="preconnect" href="https://fonts.gstatic.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700&display=swap"
          rel="stylesheet"
        />
        <link rel="preconnect" href="https://fonts.gstatic.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Rubik&display=swap"
          rel="stylesheet"
        />
        <title>${
          folderName.charAt(0).toUpperCase() + folderName.slice(1)
        }</title>
      </head>
      <body>${scriptTags.join('\n')}</body>
    </html>
  `;
}

module.exports = generateTemplateContent;
