// Web stub for expo-video — expo-video doesn't support web yet.
// This prevents the Metro bundler from crashing on web.

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function useVideoPlayer(_source: any, _setup?: (player: any) => void) {
    return null; // no-op on web
}

export function VideoView({ style }: { style?: any; player?: any; allowsFullscreen?: boolean; allowsPictureInPicture?: boolean; contentFit?: string }) {
    return (
        <View style={[styles.box, style]}>
            <Text style={styles.label}>▶ Video playback not supported in web preview.{'\n'}Open on mobile to play.</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    box: { justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A1F36', borderRadius: 16 },
    label: { color: 'rgba(255,255,255,0.5)', fontSize: 13, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
});
