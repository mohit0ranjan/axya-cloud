import { useEffect, useRef, useState } from 'react';
import { AppState, Modal, Text, TouchableOpacity, View } from 'react-native';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useUpload } from '../context/UploadContext';
import type { FileAsset } from '../services/UploadManager';

function RecordingPlayback({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const { theme } = useTheme();
  return <TouchableOpacity accessibilityRole="button" onPress={() => { if (status.playing) player.pause(); else { if (status.didJustFinish) void player.seekTo(0).then(() => player.play()); else player.play(); } }} style={{ padding: 14 }}><Text style={{ color: theme.colors.primary }}>{status.playing ? 'Pause playback' : 'Listen to recording'}</Text></TouchableOpacity>;
}

export default function VoiceRecorder({ close, folderId, chatTarget = 'me' }: { close: () => void; folderId?: string | null; chatTarget?: string }) {
  const { user } = useAuth(); const { theme } = useTheme(); const C = theme.colors; const { addUpload } = useUpload();
  const ownerId = String(user?.id || '');
  const key = `@axya_voice_draft:${ownerId}`;
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const status = useAudioRecorderState(recorder, 250);
  const [draft, setDraft] = useState<FileAsset>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const stopping = useRef(false);
  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(key).then(value => { if (!value || !active) return; const saved = JSON.parse(value); const file = new File(saved.uri); if (file.exists && file.size > 0) setDraft({ ...saved, size: file.size }); }).catch(() => { if (active) setError('Could not recover your previous recording.'); });
    return () => { active = false; };
  }, [key]);
  const stop = async () => {
    if (stopping.current) return false; stopping.current = true; setBusy(true);
    try {
      await recorder.stop();
      if (!recorder.uri) throw new Error('The recording did not produce a file. Please try again.');
      const directory = new Directory(Paths.document, 'voice-drafts', ownerId); directory.create({ idempotent: true, intermediates: true });
      const file = new File(directory, `Recording-${Date.now()}.m4a`); new File(recorder.uri).copy(file);
      if (!file.size) throw new Error('The recording is empty. Record for a little longer.');
      const asset = { uri: file.uri, name: file.name, size: file.size, mimeType: 'audio/mp4' };
      await AsyncStorage.setItem(key, JSON.stringify(asset)); setDraft(asset); await setAudioModeAsync({ allowsRecording: false }); return true;
    } catch (problem: any) { setError(problem.message || 'Could not save your recording.'); return false; }
    finally { stopping.current = false; setBusy(false); }
  };
  useEffect(() => { const subscription = AppState.addEventListener('change', state => { if (state !== 'active' && recorder.isRecording) void stop(); }); return () => subscription.remove(); }, [recorder]);
  const start = async () => {
    if (busy || draft) return; setBusy(true); setError('');
    try {
      const permission = await requestRecordingPermissionsAsync(); if (!permission.granted) throw new Error('Allow microphone access in your device settings to record audio.');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }); await recorder.prepareToRecordAsync();
      if (recorder.uri) await AsyncStorage.setItem(key, JSON.stringify({ uri: recorder.uri, name: `Recording-${Date.now()}.m4a`, mimeType: 'audio/mp4' }));
      recorder.record();
    } catch (problem: any) { setError(problem.message || 'Could not start recording.'); }
    finally { setBusy(false); }
  };
  const dismiss = async () => { if (busy) return; if (recorder.isRecording && !await stop()) return; close(); };
  const button = (label: string, action: () => void) => <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={action} style={{ padding: 15, borderRadius: 12, backgroundColor: C.primary, opacity: busy ? 0.5 : 1, marginTop: 12 }}><Text style={{ color: 'white', textAlign: 'center', fontWeight: '600' }}>{label}</Text></TouchableOpacity>;
  return <Modal visible transparent animationType="fade" onRequestClose={() => void dismiss()}><View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.45)' }}><View accessibilityViewIsModal style={{ padding: 24, borderRadius: 24, backgroundColor: C.card }}>
    <Text style={{ color: C.textHeading, fontSize: 22, fontWeight: '600', marginBottom: 16 }}>Record audio</Text>
    <Text style={{ color: C.muted, lineHeight: 22 }}>{draft ? 'Your recording is saved on this device. Listen before uploading.' : status.isRecording ? `Recording · ${Math.floor(status.durationMillis / 1000)} seconds` : 'Record a voice note and save it to your Telegram drive.'}</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: C.danger, marginTop: 12 }}>{error}</Text>}
    {draft ? <><RecordingPlayback uri={draft.uri} />{button('Upload recording', () => { addUpload(draft, folderId, chatTarget); void AsyncStorage.removeItem(key); close(); })}<TouchableOpacity onPress={() => { void AsyncStorage.removeItem(key).then(() => { setDraft(undefined); setError(''); }); }} style={{ padding: 15 }}><Text style={{ color: C.muted, textAlign: 'center' }}>Start a new recording</Text></TouchableOpacity></> : status.isRecording ? button('Stop and save draft', () => void stop()) : button(busy ? 'Preparing…' : 'Start recording', () => void start())}
    <TouchableOpacity disabled={busy} onPress={() => void dismiss()} style={{ padding: 15 }}><Text style={{ color: C.muted, textAlign: 'center' }}>Close · keep draft</Text></TouchableOpacity>
  </View></View></Modal>;
}
