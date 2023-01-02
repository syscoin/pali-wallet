export const getSvgUrl = (svg: string) =>
  URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));

export const svgUrlToPng = (svgUrl: string, callback: any) => {
  const svgImage = document.createElement('img');

  document.body.appendChild(svgImage);
  svgImage.onload = function () {
    const canvas = document.createElement('canvas');

    canvas.width = svgImage.clientWidth;
    canvas.height = svgImage.clientHeight;

    const canvasCtx = canvas.getContext('2d');

    canvasCtx.drawImage(svgImage, 0, 0);

    const imgData = canvas.toDataURL('image/png');

    callback(imgData);
  };

  svgImage.src = svgUrl;
};

export const svgToPng = (svg: string, callback: any) => {
  const url = getSvgUrl(svg);

  svgUrlToPng(url, (imgData: string) => {
    callback(imgData);
    URL.revokeObjectURL(url);
  });
};
