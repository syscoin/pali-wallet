const { AndroidConfig, withAndroidStyles } = require('expo/config-plugins');

module.exports = function withAndroidTextMetrics(config) {
  return withAndroidStyles(config, (result) => {
    // Match React Native's advance-based measurement on Android 15+.
    // Upstream fix: react/react-native@dcdb52bc80873c3d6697d930a28add09c542d073.
    result.modResults = AndroidConfig.Styles.assignStylesValue(result.modResults, {
      add: true,
      name: 'android:useBoundsForWidth',
      value: 'false',
      targetApi: 35,
      parent: AndroidConfig.Styles.getAppThemeGroup(),
    });
    return result;
  });
};
