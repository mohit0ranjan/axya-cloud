import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { PdfRef } from 'react-native-pdf';
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react-native';
import DocumentPreviewCard from './DocumentPreviewCard';
import { useTheme } from '../context/ThemeContext';
import { warmPreviewAssetUri } from '../utils/previewCache';

type Props = { baseUrl: string; fileId: string; token: string; name: string; active: boolean; sizeBytes: number; revision?: string; offlineUri?: string };
const MAX_INLINE_PDF_BYTES = 64 * 1024 * 1024;
let nativePdf: typeof import('react-native-pdf').default | null | undefined;
const getNativePdf = () => {
  if (nativePdf !== undefined) return nativePdf;
  try {
    nativePdf = require('react-native-pdf').default;
  } catch {
    nativePdf = null; // Expo Go has no PDF native module.
  }
  return nativePdf;
};

export default function PdfPreview({ baseUrl, fileId, token, name, active, sizeBytes, offlineUri, revision }: Props) {
  const { theme } = useTheme();
  const pdfRef = useRef<PdfRef>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const Pdf = getNativePdf();

  useEffect(() => {
    if (offlineUri) { setLocalUri(offlineUri); setError(false); return; }
    if (!active || !Pdf || !token || sizeBytes > MAX_INLINE_PDF_BYTES) return;
    let cancelled = false;
    setLocalUri(null);
    setError(false);
    warmPreviewAssetUri(baseUrl, fileId, token, 'download', { mimeType: 'application/pdf', revision })
      .then((uri) => {
        if (cancelled) return;
        if (!uri.startsWith('file://')) throw new Error('PDF cache unavailable');
        setLocalUri(uri);
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [revision, offlineUri, active, baseUrl, fileId, Pdf, retry, sizeBytes, token]);

  if (!active) return <View style={styles.fill} />;
  if (!Pdf) return <DocumentPreviewCard name={name} mimeType="application/pdf" />;
  if (!offlineUri && sizeBytes > MAX_INLINE_PDF_BYTES) return <DocumentPreviewCard name={name} mimeType="application/pdf" />;
  if (error) return (
    <View style={styles.fill}>
      <DocumentPreviewCard name={name} mimeType="application/pdf" />
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry PDF preview" onPress={() => { setError(false); setRetry(Date.now()); }} style={[styles.retry, { backgroundColor: theme.colors.primary }]}>
        <RotateCcw size={16} color="#fff" />
        <Text style={styles.retryText}>Retry preview</Text>
      </TouchableOpacity>
    </View>
  );

  if (!localUri) return <View style={[styles.fill, styles.loading]}><ActivityIndicator size="large" color={theme.colors.primary} /><Text style={{ color: theme.colors.textBody }}>Preparing private PDF preview…</Text></View>;

  return (
    <View style={styles.fill}>
      <Pdf
        key={`${localUri}:${retry}`}
        ref={pdfRef}
        source={{ uri: localUri, cache: false }}
        style={styles.fill}
        trustAllCerts={false}
        enableDoubleTapZoom
        minScale={1}
        maxScale={4}
        fitPolicy={0}
        renderActivityIndicator={() => <ActivityIndicator size="large" color={theme.colors.primary} />}
        onLoadComplete={(count) => { setPages(count); setPage(1); }}
        onPageChanged={(current, count) => { setPage(current); setPages(count); }}
        onError={() => setError(true)}
      />
      {pages > 0 && <View style={[styles.controls, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous PDF page" disabled={page <= 1} onPress={() => pdfRef.current?.setPage(page - 1)} style={styles.arrow}>
          <ChevronLeft size={22} color={page <= 1 ? theme.colors.textBody : theme.colors.primary} />
        </TouchableOpacity>
        <Text accessibilityLiveRegion="polite" style={[styles.page, { color: theme.colors.textHeading }]}>{page} / {pages}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next PDF page" disabled={page >= pages} onPress={() => pdfRef.current?.setPage(page + 1)} style={styles.arrow}>
          <ChevronRight size={22} color={page >= pages ? theme.colors.textBody : theme.colors.primary} />
        </TouchableOpacity>
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: { alignItems: 'center', justifyContent: 'center', gap: 12 },
  controls: { position: 'absolute', bottom: 16, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 24, elevation: 3 },
  arrow: { width: 52, height: 44, alignItems: 'center', justifyContent: 'center' },
  page: { minWidth: 52, textAlign: 'center', fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  retry: { alignSelf: 'center', flexDirection: 'row', gap: 8, alignItems: 'center', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, marginBottom: 24 },
  retryText: { color: '#fff', fontFamily: 'Inter_600SemiBold' },
});
