module.exports = function (api) {
    api.cache(true);
    return {
        presets: ['babel-preset-expo'],
        plugins: [
            // Required for react-native-reanimated worklets (pinch-zoom, animations)
            // MUST be listed last
            'react-native-reanimated/plugin',
        ],
    };
};
