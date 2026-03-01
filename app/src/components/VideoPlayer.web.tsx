import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function VideoPlayer({ width: w }: {
    url: string; token: string; width: number; onError: () => void;
}) {
    return (
        <View style={[styles.box, { width: w, height: w * 0.75 }]}>
            <Text style={styles.label}>
                ▶ Video playback is not supported in the web preview.{'\n'}
                Open the app on mobile to play this video.
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    box: {
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#1A1F36',
        borderRadius: 16,
        padding: 20
    },
    label: {
        color: 'rgba(255,255,255,0.6)',
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 22
    },
});
