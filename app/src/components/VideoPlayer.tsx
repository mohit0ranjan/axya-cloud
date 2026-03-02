import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react-native';

interface VideoPlayerProps {
    url: string;
    token: string;
    width: number;
    onError?: (error: any) => void;
}

export default function VideoPlayer({ url, token, width: w, onError }: VideoPlayerProps) {
    const [loading, setLoading] = useState(true);
    const [muted, setMuted] = useState(false);
    const [isPlaying, setIsPlaying] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const player = useVideoPlayer({ uri: url, headers: { Authorization: `Bearer ${token}` } }, p => {
        p.loop = false;
        p.muted = muted;
        p.play();
    });

    useEffect(() => {
        setLoading(true);
        setLoadError(null);
        const sub = player.addListener('statusChange', (payload: any) => {
            if (payload?.error) {
                const message = payload.error?.message || 'Video failed to load';
                setLoadError(message);
                setLoading(false);
                onError?.(payload.error);
                return;
            }
            if (payload?.status === 'readyToPlay') setLoading(false);
        });
        return () => sub.remove();
    }, [player, onError]);

    useEffect(() => {
        const sub = player.addListener('playingChange', (payload) => {
            setIsPlaying(payload.isPlaying);
        });
        return () => sub.remove();
    }, [player]);

    useEffect(() => {
        player.muted = muted;
    }, [muted, player]);

    const togglePlay = () => {
        if (isPlaying) player.pause();
        else player.play();
    };

    const toggleMute = () => {
        setMuted(!muted);
    };

    return (
        <View style={[s.container, { width: w, height: w * 0.5625 }]}>
            <VideoView
                player={player}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                nativeControls
                onPointerEnter={() => { }} // dummy
            />

            {loading && (
                <View style={s.overlay}>
                    <ActivityIndicator size="large" color="#4B6EF5" />
                </View>
            )}

            {loadError && (
                <View style={s.errorOverlay}>
                    <Text style={s.errorText} numberOfLines={3}>{loadError}</Text>
                </View>
            )}

            {/* Custom Overlay Controls */}
            <View style={s.controlsOverlay}>
                <View style={s.topRow}>
                    <TouchableOpacity style={s.iconBtn} onPress={toggleMute}>
                        {muted ? <VolumeX color="#fff" size={20} /> : <Volume2 color="#fff" size={20} />}
                    </TouchableOpacity>
                </View>

                <View style={s.centerRow}>
                    {!loading && (
                        <TouchableOpacity style={s.playBtn} onPress={togglePlay}>
                            {isPlaying ? <Pause color="#fff" size={32} fill="#fff" /> : <Play color="#fff" size={32} fill="#fff" />}
                        </TouchableOpacity>
                    )}
                </View>

                <View style={s.bottomRow}>
                    {/* Native progress is usually enough if we use nativeControls, 
                        but if we want premium we might want a slider.
                        For now, let's stick to nativeControls true if we want better stability 
                        or a simple custom one. */}
                </View>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    container: {
        backgroundColor: '#000',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden',
    },
    overlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.3)',
    },
    errorOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.55)',
        paddingHorizontal: 16,
    },
    errorText: {
        color: '#fff',
        fontSize: 13,
        textAlign: 'center',
    },
    controlsOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'space-between',
        padding: 16,
    },
    topRow: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
    centerRow: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    bottomRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    playBtn: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    iconBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'center',
        alignItems: 'center',
    }
});
