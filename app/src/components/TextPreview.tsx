import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { File } from 'expo-file-system';

const MAX_PREVIEW_BYTES = 64 * 1024;

export default function TextPreview({ url, token, active, size }: { url: string; token: string; active: boolean; size: number }) {
  const { theme } = useTheme();
  const c = theme.colors;
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setText(null);
    setError('');
    if (!active) return;
    const controller = new AbortController();
    let mounted = true;
    const timeout = setTimeout(() => controller.abort(), 60_000);
    (async () => {
      try {
        if (url.startsWith('file://')) {
          const local = new File(url); const reader = local.open();
          try { const bytes = reader.readBytes(Math.min(MAX_PREVIEW_BYTES, local.size)); if (mounted) setText(new TextDecoder().decode(bytes)); }
          finally { reader.close(); }
          return;
        }
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Range: `bytes=0-${MAX_PREVIEW_BYTES - 1}` }, signal: controller.signal });
        if (!response.ok) throw new Error('Could not load this document.');
        if (response.status !== 206 && Number(response.headers.get('content-length') || size) > MAX_PREVIEW_BYTES) {
          throw new Error('Download this document to view the full content.');
        }
        const result = await response.text();
        if (mounted) setText(result);
      } catch (failure: any) {
        if (mounted) setError(controller.signal.aborted ? 'Loading timed out. Please retry.' : failure.message || 'Could not load this document.');
      } finally { clearTimeout(timeout); }
    })();
    return () => { mounted = false; controller.abort(); clearTimeout(timeout); };
  }, [url, token, active, retry, size]);

  if (!active) return null;
  return <View style={{ flex: 1, margin: 16, borderRadius: 20, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, overflow: 'hidden' }}>
    {error ? <View style={{ padding: 24, gap: 16 }}>
      <Text style={{ color: c.textBody }}>{error}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry document preview" onPress={() => setRetry(value => value + 1)}><Text style={{ color: c.primary }}>Retry</Text></TouchableOpacity>
    </View> : text === null ? <ActivityIndicator style={{ margin: 32 }} color={c.primary} accessibilityLabel="Loading document" /> : <>
      {size > MAX_PREVIEW_BYTES && <Text style={{ padding: 14, color: c.textBody }}>Preview of the first 64 KB · Download for the full file</Text>}
      <ScrollView contentContainerStyle={{ padding: 20 }}><Text selectable style={{ color: c.textHeading, fontSize: 14, lineHeight: 22 }}>{text || 'Empty document'}</Text></ScrollView>
    </>}
  </View>;
}
