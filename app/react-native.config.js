// We use the bundled official TDLib JNI classes from Axya's service-owned
// Expo module, not the community package's foreground React Native singleton.
module.exports = { dependencies: { 'react-native-tdlib': { platforms: { android: null, ios: null } } } };
