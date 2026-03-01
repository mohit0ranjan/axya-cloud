import React from 'react';
import { VideoView, useVideoPlayer } from 'expo-video';

export default function VideoPlayer({ url, token, width: w, onError }: {
    url: string; token: string; width: number; onError: () => void;
}) {
    const player = useVideoPlayer({ uri: url, headers: { Authorization: `Bearer ${token}` } }, p => {
        p.loop = false;
        p.play();
    });
    return (
        <VideoView
            player={player}
            style={{ width: w, height: w * 0.75 }}
            nativeControls
            contentFit="contain"
        />
    );
}
