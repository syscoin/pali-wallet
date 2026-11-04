module.exports = function (api) {
  const production = api.env('production');
  return {
    presets: ['babel-preset-expo'],
    plugins: production ? ['transform-remove-console'] : [],
  };
};
