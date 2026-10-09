import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import apiClient from '../services/apiClient';
import { isLocalVideo, videoErrorMessage, VideoPlayerProps, webPlaybackUrl } from '../utils/videoPlayback';

function VideoPlayer({ url, token, width, fileId, onError }: VideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const restoreRef = useRef<{ time: number; playing: boolean } | null>(null);
    const callbackRef = useRef(onError); callbackRef.current = onError;
    const [source, setSource] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(true);
    const [slow, setSlow] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [rate, setRate] = useState(1);
    const identityRef = useRef(url);
    useEffect(() => {
        if (identityRef.current !== url) { restoreRef.current = null; identityRef.current = url; }
        let active = true, timer: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();
        setSource(''); setError(''); setLoading(true); setRate(1);
        const prepare = async (renew = false) => {
            try {
                if (isLocalVideo(url)) { if (active) setSource(url); return; }
                if (!fileId) throw new Error('Video source is missing its file ID.');
                const response = await apiClient.post(`/files/${encodeURIComponent(fileId)}/playback-ticket`, {}, {
                    headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
                });
                if (!active) return;
                if (!response.data?.ticket) throw new Error('Cannot prepare video access. Please retry.');
                if (renew && videoRef.current) restoreRef.current = { time: videoRef.current.currentTime, playing: !videoRef.current.paused };
                setSource(webPlaybackUrl(url, fileId, response.data.ticket));
                const seconds = Number(response.data.expiresIn) || 3600;
                timer = setTimeout(() => void prepare(true), Math.max(30, seconds - 60) * 1000);
            } catch (failure: any) {
                if (!active || controller.signal.aborted) return;
                setError(failure?.response?.status === 401 ? 'Please sign in again to play this video.' : failure?.message || videoErrorMessage());
                setLoading(false); callbackRef.current?.(failure);
            }
        };
        void prepare();
        return () => { active = false; controller.abort(); if (timer) clearTimeout(timer); };
    }, [url, token, fileId, attempt]);
    useEffect(() => {
        setSlow(false);
        if (!loading) return;
        const timer = setTimeout(() => setSlow(true), 12000);
        return () => clearTimeout(timer);
    }, [loading]);
    const retry = () => {
        if (videoRef.current) restoreRef.current = { time: videoRef.current.currentTime, playing: true };
        setAttempt(value => value + 1);
    };
    const video = source ? React.createElement('video', {
        key: `${source}-${attempt}`, ref: videoRef, src: source, controls: true, playsInline: true, preload: 'metadata',
        'aria-label': 'Video preview',
        style: { display: 'block', width: '100%', height: '100%', objectFit: 'contain', background: '#090E1A' },
        onLoadStart: () => setLoading(true), onWaiting: () => setLoading(true),
        onCanPlay: () => setLoading(false), onPlaying: () => { setLoading(false); setError(''); },
        onLoadedData: () => setLoading(false),
        onLoadedMetadata: () => {
            const media = videoRef.current, restore = restoreRef.current;
            if (media && restore) {
                media.currentTime = Math.min(restore.time, Number.isFinite(media.duration) ? media.duration : restore.time);
                if (restore.playing) void media.play().catch(() => { /* User gesture may be required. Controls remain usable. */ });
                restoreRef.current = null;
            }
        },
        onRateChange: () => setRate(videoRef.current?.playbackRate || 1),
        onError: () => {
            const failure = videoRef.current?.error;
            if (failure?.code === 1) return;
            setError(videoErrorMessage(failure?.code)); setLoading(false); callbackRef.current?.(failure);
        },
    }) : null;
    return <View style={[styles.root, { width, height: width * 0.5625 }]}>
        {video}
        {loading && !error && <View pointerEvents="none" style={styles.loading}>
            <ActivityIndicator color="#FFFFFF" /><Text style={styles.label}>{slow ? 'Taking longer to load. Check your connection.' : source ? 'Buffering…' : 'Preparing video…'}</Text>
        </View>}
        {!!source && !error && !loading && <Pressable accessibilityRole="button" accessibilityLabel={`Playback speed ${rate} times. Change speed`} style={styles.speed}
            onPress={() => { if (videoRef.current) videoRef.current.playbackRate = rate === 1 ? 1.5 : rate === 1.5 ? 2 : 1; }}>
            <Text style={styles.buttonText}>{rate}×</Text>
        </Pressable>}
        {!!error && <View style={styles.error}>
            <Text accessibilityRole="alert" style={styles.label}>{error}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Retry video" onPress={retry} style={styles.retry}><Text style={styles.buttonText}>Retry</Text></Pressable>
        </View>}
    </View>;
}
export default React.memo(VideoPlayer);
const styles = StyleSheet.create({
    root: { backgroundColor: '#090E1A', overflow: 'hidden' },
    loading: { position: 'absolute', top: 12, left: 12, right: 12, borderRadius: 16, alignItems: 'center', padding: 12, gap: 8, backgroundColor: 'rgba(9,14,26,0.8)' },
    label: { color: '#FFFFFF', fontSize: 13, lineHeight: 20, textAlign: 'center' },
    error: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 20, gap: 16, backgroundColor: 'rgba(9,14,26,0.92)' },
    retry: { minHeight: 44, justifyContent: 'center', backgroundColor: '#3174FF', borderRadius: 22, paddingHorizontal: 24 },
    buttonText: { color: '#FFFFFF', fontWeight: '600' },
    speed: { position: 'absolute', top: 12, right: 12, minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 22, backgroundColor: 'rgba(9,14,26,0.75)' },
});
