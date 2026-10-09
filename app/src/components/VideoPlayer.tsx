import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { RotateCcw } from 'lucide-react-native';
import { isLocalVideo, VideoPlayerProps } from '../utils/videoPlayback';

function VideoPlayer({ url, token, width, onError }: VideoPlayerProps) {
    const local = isLocalVideo(url);
    const source = useMemo(() => ({ uri: url, contentType: 'progressive' as const,
        ...(local ? {} : { headers: { Authorization: `Bearer ${token}` } }),
    }), [url, token, local]);
    const player = useVideoPlayer(source, p => {
        p.loop = false;
        p.bufferOptions = { preferredForwardBufferDuration: 15, minBufferForPlayback: 1.5, maxBufferBytes: 32 * 1024 * 1024 };
        p.play();
    });
    const [loading, setLoading] = useState(player.status !== 'readyToPlay');
    const [error, setError] = useState('');
    const [slow, setSlow] = useState(false);
    const [rate, setRate] = useState(1);
    const hasPlayed = useRef(false);
    const onErrorRef = useRef(onError);
    onErrorRef.current = onError;
    useEffect(() => {
        hasPlayed.current = false;
        setError(''); setSlow(false); setRate(1);
        const update = ({ status, error: failure }: { status: string; error?: { message: string } }) => {
            if (status === 'error') {
                const message = failure?.message || 'Video could not load. Check your connection and retry.';
                setError(message); setLoading(false); onErrorRef.current?.(failure);
            } else {
                setLoading(status === 'loading' || status === 'idle');
                if (status === 'readyToPlay') { setError(''); hasPlayed.current = true; }
            }
        };
        const subscription = player.addListener('statusChange', update);
        update({ status: player.status });
        const appState = AppState.addEventListener('change', state => { if (state !== 'active') player.pause(); });
        return () => { subscription.remove(); appState.remove(); };
    }, [player, source]);
    useEffect(() => {
        setSlow(false);
        if (!loading) return;
        const timer = setTimeout(() => setSlow(true), 12000);
        return () => clearTimeout(timer);
    }, [loading]);
    const retry = async () => {
        const position = player.currentTime;
        setError(''); setLoading(true);
        try { await player.replaceAsync(source); player.currentTime = position; player.play(); }
        catch (failure) { setLoading(false); setError('Video could not load. Check your connection and retry.'); onErrorRef.current?.(failure); }
    };
    return <View style={[styles.root, { width, height: width * 0.5625 }]}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls fullscreenOptions={{ enable: true }} />
        {loading && !error && <View pointerEvents="none" style={styles.loading}>
            <ActivityIndicator color="#FFFFFF" />
            <Text style={styles.label}>{slow ? 'Taking longer to load. Check your connection.' : hasPlayed.current ? 'Buffering…' : 'Preparing video…'}</Text>
        </View>}
        {!loading && !error && <Pressable accessibilityRole="button" accessibilityLabel={`Playback speed ${rate} times. Change speed`}
            style={styles.speed} onPress={() => { const next = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; player.playbackRate = next; setRate(next); }}>
            <Text style={styles.speedText}>{rate}×</Text>
        </Pressable>}
        {!!error && <View style={styles.error}>
            <Text accessibilityRole="alert" style={styles.label}>{error}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Retry video" style={styles.retry} onPress={() => void retry()}>
                <RotateCcw color="#FFFFFF" size={18} /><Text style={styles.speedText}>Retry</Text>
            </Pressable>
        </View>}
    </View>;
}
export default React.memo(VideoPlayer);
const styles = StyleSheet.create({
    root: { backgroundColor: '#090E1A', overflow: 'hidden' },
    loading: { position: 'absolute', top: 12, left: 12, right: 12, padding: 12, gap: 8, alignItems: 'center', borderRadius: 16, backgroundColor: 'rgba(9,14,26,0.8)' },
    label: { color: '#FFFFFF', fontSize: 13, lineHeight: 20, textAlign: 'center' },
    speed: { position: 'absolute', top: 12, right: 12, paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 22, backgroundColor: 'rgba(9,14,26,0.75)' },
    speedText: { color: '#FFFFFF', fontWeight: '600' },
    error: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 16, backgroundColor: 'rgba(9,14,26,0.92)' },
    retry: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#3174FF', paddingHorizontal: 22, minHeight: 44, borderRadius: 22 },
});
