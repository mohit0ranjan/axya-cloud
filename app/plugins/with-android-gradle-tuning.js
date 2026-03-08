const { withGradleProperties, withProjectBuildGradle } = require('expo/config-plugins');

function setGradleProperty(config, key, value) {
  const existing = config.modResults.find((item) => item.type === 'property' && item.key === key);
  if (existing) {
    existing.value = value;
  } else {
    config.modResults.push({ type: 'property', key, value });
  }
  return config;
}

function removeJitPackRepository(config) {
  return withProjectBuildGradle(config, (gradleConfig) => {
    gradleConfig.modResults.contents = gradleConfig.modResults.contents.replace(
      /\n\s*maven\s*\{\s*url\s+'https:\/\/www\.jitpack\.io'\s*\}\s*/g,
      '\n'
    );
    return gradleConfig;
  });
}

module.exports = function withAndroidGradleTuning(config) {
  config = withGradleProperties(config, (gradleConfig) => {
    setGradleProperty(
      gradleConfig,
      'org.gradle.jvmargs',
      '-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8'
    );
    return gradleConfig;
  });

  config = removeJitPackRepository(config);

  return config;
};
