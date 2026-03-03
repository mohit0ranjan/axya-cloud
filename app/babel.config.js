module.exports = function (api) {
    api.cache(true);
    return {
        presets: ['babel-preset-expo'],
        plugins: [
            // Reanimated v4 uses the worklets Babel plugin.
            // MUST be listed last.
            'react-native-worklets/plugin',
        ],
    };
};
