/** Development-only playback QA with an isolated loopback fixture. No account credentials or Telegram uploads. */
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import VideoPlayer from '../components/VideoPlayer';
import apiClient from '../services/apiClient';

export default function VideoReview() {
    const [ready, setReady] = useState(false), [invalid, setInvalid] = useState(false), [attempt, setAttempt] = useState(0);
    const { width } = useWindowDimensions();
    useEffect(() => {
        const previous = apiClient.post;
        apiClient.post = (async (url: string, ...args: any[]) => {
            if (url !== '/files/video-fixture/playback-ticket') return previous.call(apiClient, url, ...args);
            const response = await fetch('http://localhost:3033/files/video-fixture/playback-ticket', {
                method: 'POST', headers: { Authorization: 'Bearer video-test-only' }, signal: args[1]?.signal,
            });
            if (!response.ok) throw new Error('Start the isolated video fixture server on port 3033.');
            return { data: await response.json() };
        }) as typeof apiClient.post;
        setReady(true);
        return () => { apiClient.post = previous; };
    }, []);
    const playerWidth = Math.min(width - 32, 760);
    return <View style={{ flex: 1, backgroundColor: '#F5F7FC', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 20 }}>
        <Text style={{ color: '#1A233B', fontSize: 26, fontWeight: '700' }}>Video playback check</Text>
        <Text style={{ color: '#6F7C94', textAlign: 'center' }}>Isolated sample • private range gateway • no account files</Text>
        {ready && <VideoPlayer key={`${invalid}-${attempt}`} url={invalid ? 'data:video/mp4;base64,bm90IGEgdmlkZW8=' : 'http://localhost:3033/files/video-fixture/stream'}
            fileId="video-fixture" token="video-test-only" width={playerWidth} />}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
            <Pressable accessibilityRole="button" onPress={() => setInvalid(false)} style={{ padding: 14, borderRadius: 24, backgroundColor: '#DBEAFE' }}><Text>Private stream</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => setInvalid(true)} style={{ padding: 14, borderRadius: 24, backgroundColor: '#DBEAFE' }}><Text>Unsupported video</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => setAttempt(value => value + 1)} style={{ padding: 14, borderRadius: 24, backgroundColor: '#DBEAFE' }}><Text>Reload player</Text></Pressable>
        </View>
    </View>;
}
