const { withGradleProperties } = require('expo/config-plugins');

function setGradleProperty(config, key, value) {
  const existing = config.modResults.find((item) => item.type === 'property' && item.key === key);
  if (existing) {
    existing.value = value;
  } else {
    config.modResults.push({ type: 'property', key, value });
  }
  return config;
}

module.exports = function withAndroidGradleTuning(config) {
  return withGradleProperties(config, (gradleConfig) => {
    setGradleProperty(
      gradleConfig,
      'org.gradle.jvmargs',
      '-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8'
    );
    return gradleConfig;
  });
};
