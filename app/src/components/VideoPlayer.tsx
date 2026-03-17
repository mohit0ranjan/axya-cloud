/**
 * VideoPlayer.tsx — Production video player with streaming badges
 *
 * ✅ expo-video with auth headers for Range-based streaming
 * ✅ Loading overlay with progressive status messages
 * ✅ "Streaming…" badge while Telegram download is in progress
 * ✅ "Downloaded" badge once file is fully cached
 * ✅ Error overlay with retry button
 * ✅ Smooth controls overlay: play/pause, mute/unmute
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Play, Pause, Volume2, VolumeX, RotateCcw, Wifi, HardDrive } from 'lucide-react-native';
import apiClient from '../services/apiClient';
import { sanitizeRemoteUri } from '../utils/fileSafety';

interface VideoPlayerProps {
    url: string;
    token: string;
    width: number;
    fileId?: string;  // For stream status polling
    onError?: (error: any) => void;
}

type StreamBadge = 'none' | 'streaming' | 'downloaded';

export default function VideoPlayer({ url, token, width: w, fileId, onError }: VideoPlayerProps) {
    const [loading, setLoading] = useState(true);
    const [muted, setMuted] = useState(false);
    const [isPlaying, setIsPlaying] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [loadingMsg, setLoadingMsg] = useState('Preparing video…');
    const [streamBadge, setStreamBadge] = useState<StreamBadge>('none');
    const [downloadProgress, setDownloadProgress] = useState(0);
    const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const statusInterval = useRef<ReturnType<typeof setInterval> | null>(null);
    const safeUrl = sanitizeRemoteUri(url);

    const player = useVideoPlayer(
        { uri: safeUrl, headers: { Authorization: `Bearer ${token}` } },
        (p) => {
            p.loop = false;
            p.muted = muted;
            p.play();
        }
    );

    // ── Stream status polling ────────────────────────────────────────────────
    // Polls the backend for cache status to show Streaming/Downloaded badge
    useEffect(() => {
        if (!fileId) return;

        const pollStatus = async () => {
            try {
                const res = await apiClient.get(`/stream/${fileId}/status`);
                if (res.data?.success) {
                    const { status, progress } = res.data;
                    if (status === 'ready') {
                        setStreamBadge('downloaded');
                        setDownloadProgress(100);
                        // Stop polling once fully cached
                        if (statusInterval.current) {
                            clearInterval(statusInterval.current);
                            statusInterval.current = null;
                        }
                    } else if (status === 'downloading') {
                        setStreamBadge('streaming');
                        setDownloadProgress(progress || 0);
                    }
                }
            } catch {
                // Non-critical — badge just won't show
            }
        };

        // Initial check
        pollStatus();

        // Poll every 2 seconds during active streaming
        statusInterval.current = setInterval(pollStatus, 2000);

        return () => {
            if (statusInterval.current) {
                clearInterval(statusInterval.current);
                statusInterval.current = null;
            }
        };
    }, [fileId]);

    // ── Progressive loading messages ─────────────────────────────────────────
    useEffect(() => {
        if (!loading) return;

        loadTimer.current = setTimeout(() => {
            setLoadingMsg('Downloading from Telegram…');
        }, 3000);

        const t2 = setTimeout(() => {
            setLoadingMsg('Still loading — large files take longer…');
        }, 10000);

        const t3 = setTimeout(() => {
            setLoadingMsg('Almost there…');
        }, 25000);

        return () => {
            if (loadTimer.current) clearTimeout(loadTimer.current);
            clearTimeout(t2);
            clearTimeout(t3);
        };
    }, [loading]);

    useEffect(() => {
        setLoading(true);
        setLoadError(null);
        setLoadingMsg('Preparing video…');

        const sub = player.addListener('statusChange', (payload: any) => {
            if (payload?.error) {
                const message = payload.error?.message || 'Video failed to load';
                setLoadError(message);
                setLoading(false);
                onError?.(payload.error);
                return;
            }
            if (payload?.status === 'readyToPlay') {
                setLoading(false);
            }
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

    const togglePlay = useCallback(() => {
        if (isPlaying) player.pause();
        else player.play();
    }, [isPlaying, player]);

    const toggleMute = useCallback(() => {
        setMuted((m) => !m);
    }, []);

    const handleRetry = useCallback(() => {
        setLoadError(null);
        setLoading(true);
        setLoadingMsg('Retrying…');
        player.replace({ uri: safeUrl, headers: { Authorization: `Bearer ${token}` } });
        player.play();
    }, [player, safeUrl, token]);

    return (
        <View style={[s.container, { width: w, height: w * 0.5625 }]}>
            <VideoView
                player={player}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                nativeControls
                onPointerEnter={() => { }}
            />

            {/* ── Loading Overlay ──────────────────────────────────────── */}
            {loading && !loadError && (
                <View style={s.overlay}>
                    <ActivityIndicator size="large" color="#4B6EF5" />
                    <Text style={s.loadingText}>{loadingMsg}</Text>
                    {downloadProgress > 0 && downloadProgress < 100 && (
                        <Text style={s.progressText}>{downloadProgress}% cached</Text>
                    )}
                </View>
            )}

            {/* ── Error Overlay ──────────────────────────────────────── */}
            {loadError && (
                <View style={s.errorOverlay}>
                    <Text style={s.errorText} numberOfLines={3}>
                        {loadError}
                    </Text>
                    <TouchableOpacity style={s.retryBtn} onPress={handleRetry}>
                        <RotateCcw color="#fff" size={16} />
                        <Text style={s.retryText}>Retry</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* ── Controls Overlay ────────────────────────────────────── */}
            <View style={s.controlsOverlay}>
                <View style={s.topRow}>
                    {/* Stream badge */}
                    {streamBadge !== 'none' && !loading && (
                        <View style={[
                            s.streamBadge,
                            streamBadge === 'downloaded' ? s.downloadedBadge : s.streamingBadge,
                        ]}>
                            {streamBadge === 'streaming' ? (
                                <Wifi color="#fff" size={12} />
                            ) : (
                                <HardDrive color="#fff" size={12} />
                            )}
                            <Text style={s.badgeText}>
                                {streamBadge === 'streaming'
                                    ? `Caching… ${downloadProgress}%`
                                    : 'Downloaded'
                                }
                            </Text>
                        </View>
                    )}
                    <View style={{ flex: 1 }} />
                    <TouchableOpacity style={s.iconBtn} onPress={toggleMute}>
                        {muted
                            ? <VolumeX color="#fff" size={20} />
                            : <Volume2 color="#fff" size={20} />
                        }
                    </TouchableOpacity>
                </View>

                <View style={s.centerRow}>
                    {!loading && !loadError && (
                        <TouchableOpacity style={s.playBtn} onPress={togglePlay}>
                            {isPlaying
                                ? <Pause color="#fff" size={32} fill="#fff" />
                                : <Play color="#fff" size={32} fill="#fff" />
                            }
                        </TouchableOpacity>
                    )}
                </View>

                <View style={s.bottomRow} />
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
        backgroundColor: 'rgba(0,0,0,0.55)',
        gap: 12,
    },
    loadingText: {
        color: 'rgba(255,255,255,0.8)',
        fontSize: 13,
        fontWeight: '600',
        textAlign: 'center',
        marginTop: 4,
    },
    progressText: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 11,
        fontWeight: '500',
    },
    errorOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.65)',
        paddingHorizontal: 24,
        gap: 16,
    },
    errorText: {
        color: '#fff',
        fontSize: 13,
        textAlign: 'center',
    },
    retryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: '#4B6EF5',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 12,
    },
    retryText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '700',
    },
    controlsOverlay: {
        ...StyleSheet.absoluteFillObject,
        justifyContent: 'space-between',
        padding: 16,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
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
    },

    // ── Stream badge ─────────────────────────────────────────────────────
    streamBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 12,
    },
    streamingBadge: {
        backgroundColor: 'rgba(245, 158, 11, 0.8)', // amber
    },
    downloadedBadge: {
        backgroundColor: 'rgba(16, 185, 129, 0.8)', // green
    },
    badgeText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.2,
    },
});
