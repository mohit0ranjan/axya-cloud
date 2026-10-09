import React, { useMemo, useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, useWindowDimensions, FlatList } from 'react-native';
import { ChevronUp, ChevronDown, Check, AlertCircle, X, UploadCloud, Download, Play, Pause, RefreshCcw } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUpload } from '../context/UploadContext';
import { useDownload } from '../context/DownloadContext';
import { useTheme } from '../context/ThemeContext';
import { useReducedMotion } from '../hooks/useReducedMotion';

const activeStates = new Set(['pending', 'preparing', 'uploading', 'downloading', 'processing', 'queued', 'retrying', 'waiting_retry']);
const pausableStates = new Set(['pending', 'preparing', 'uploading', 'queued', 'retrying', 'waiting_retry']);
const bytes = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(0, n / 1024).toFixed(0)} KB`;
const percent = (task: any) => Math.max(0, Math.min(100, Number(task.progress) || 0));

const TaskRow = React.memo(({ task, onCancel, onPause, onResume }: any) => {
  const { theme } = useTheme();
  const c = theme.colors;
  const done = task.status === 'completed', failed = task.status === 'failed';
  const paused = task.status === 'paused', upload = task._type === 'upload';
  let label = task.status === 'processing' ? 'Saving to Telegram' : task.status === 'preparing' ? 'Preparing file' : task.status === 'queued' || task.status === 'pending' ? 'Waiting in queue' : paused ? 'Paused · ready to resume' : failed ? task.error || 'Transfer failed' : done ? upload ? 'Uploaded' : task.browserHandoff ? 'Opened in browser downloads' : 'Downloaded' : task.status === 'waiting_retry' || task.status === 'retrying' ? 'Connection interrupted · retrying' : `${Math.round(percent(task))}% · ${bytes(task.bytesUploaded || task.bytesDownloaded || 0)}${task.file?.size ? ` of ${bytes(task.file.size)}` : ''}`;
  if (task.status === 'uploading' && task.currentSpeedBps > 0) label += ` · ${bytes(task.currentSpeedBps)}/s`;
  return <View style={[s.row, { borderBottomColor: c.border }]}>
    <View style={[s.rowIcon, { backgroundColor: done ? `${c.success}15` : failed ? `${c.danger}15` : `${c.primary}12` }]}>
      {done ? <Check color={c.success} size={20} /> : failed ? <AlertCircle color={c.danger} size={20} /> : upload ? <UploadCloud color={c.primary} size={20} /> : <Download color={c.primary} size={20} />}
    </View>
    <View style={s.rowInfo}>
      <Text style={[s.rowName, { color: c.textHeading }]} numberOfLines={1}>{task.file?.name || task.fileName || 'File'}</Text>
      <Text style={[s.rowStatus, { color: failed ? c.danger : done ? c.success : c.muted }]} numberOfLines={2}>{label}</Text>
      {activeStates.has(task.status) && <View style={[s.track, { backgroundColor: c.border }]}><View style={{ height: 3, width: `${percent(task)}%`, backgroundColor: c.primary }} /></View>}
    </View>
    {upload && (paused || failed || pausableStates.has(task.status)) && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${paused || failed ? 'Resume' : 'Pause'} ${task.file?.name || 'upload'}`} style={s.iconBtn} onPress={() => paused || failed ? onResume(task.id) : onPause(task.id)}>
      {failed ? <RefreshCcw color={c.primary} size={18} /> : paused ? <Play color={c.primary} size={18} /> : <Pause color={c.muted} size={18} />}
    </TouchableOpacity>}
    {!done && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Cancel ${task.file?.name || 'transfer'}`} style={s.iconBtn} onPress={() => onCancel(task.id)}><X color={c.muted} size={18} /></TouchableOpacity>}
  </View>;
});

export default function SyncActivityOverlay() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { theme } = useTheme();
  const c = theme.colors;
  const uploads = useUpload(), downloads = useDownload();
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false), [dismissed, setDismissed] = useState(false);
  const animation = useRef(new Animated.Value(0)).current;
  const tasks = useMemo(() => [
    ...uploads.tasks.filter(t => t.status !== 'cancelled').map(t => ({ ...t, _type: 'upload' })),
    ...downloads.tasks.filter(t => t.status !== 'cancelled').map(t => ({ ...t, _type: 'download' }))
  ].sort((a, b) => Number(activeStates.has(b.status)) - Number(activeStates.has(a.status))), [uploads.tasks, downloads.tasks]);
  const running = tasks.filter(t => activeStates.has(t.status)).length;
  const paused = tasks.filter(t => t.status === 'paused').length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  const done = tasks.filter(t => t.status === 'completed').length;
  const allDone = tasks.length > 0 && done === tasks.length;
  const activeTasks = tasks.filter(t => activeStates.has(t.status) || t.status === 'paused');
  const transferProgress = activeTasks.length
    ? activeTasks.reduce((sum, task) => sum + percent(task), 0) / activeTasks.length : allDone ? 100 : 0;
  const previousIds = useRef(new Set<string>());
  useEffect(() => {
    if (tasks.some(t => !previousIds.current.has(t.id))) setDismissed(false);
    previousIds.current = new Set(tasks.map(t => t.id));
  }, [tasks]);
  useEffect(() => {
    Animated.timing(animation, { toValue: expanded ? 1 : 0, duration: reducedMotion ? 0 : 200, useNativeDriver: false }).start();
  }, [expanded, reducedMotion]);
  useEffect(() => {
    if (!allDone || expanded) return;
    const timer = setTimeout(() => setDismissed(true), 7000);
    return () => clearTimeout(timer);
  }, [allDone, expanded]);
  const pauseAll = () => uploads.tasks.filter(t => pausableStates.has(t.status)).forEach(t => uploads.pauseUpload(t.id));
  const resumeAll = () => uploads.tasks.filter(t => t.status === 'paused' || t.status === 'failed').forEach(t => uploads.resumeUpload(t.id));
  const title = allDone ? `${done} ${done === 1 ? 'file' : 'files'} ready` : 'Transfers';
  const summary = [running ? `${running} in progress` : '', paused ? `${paused} paused` : '', failed ? `${failed} need attention` : '', done && !allDone ? `${done} complete` : ''].filter(Boolean).join(' · ') || 'Saved to your storage';
  if (!tasks.length || dismissed) return null;
  return <View style={[s.container, { width: Math.min(width - 24, 460), right: 12, bottom: Math.max(insets.bottom, 12) + 80, backgroundColor: c.card, borderColor: c.border }]}>
    <View style={s.header}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} transfers`} accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={s.headerMain}>
        <View style={[s.headerIcon, { backgroundColor: `${c.primary}12` }]}>{allDone ? <Check color={c.success} size={20} /> : failed ? <AlertCircle color={c.danger} size={20} /> : <UploadCloud color={c.primary} size={20} />}</View>
        <View style={{ flex: 1 }}><Text style={[s.title, { color: c.textHeading }]}>{title}</Text><Text style={[s.subtitle, { color: c.muted }]} numberOfLines={1}>{summary}</Text></View>
        {expanded ? <ChevronDown color={c.muted} size={19} /> : <ChevronUp color={c.muted} size={19} />}
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Hide transfer panel; transfers continue" onPress={() => setDismissed(true)} style={s.iconBtn}><X color={c.muted} size={19} /></TouchableOpacity>
    </View>
    {!allDone && <View style={[s.track, { marginHorizontal: 16, marginBottom: 10, backgroundColor: c.border }]}><View style={{ height: 3, width: `${transferProgress}%`, backgroundColor: c.primary }} /></View>}
    <Animated.View style={{ height: animation.interpolate({ inputRange: [0, 1], outputRange: [0, Math.min(tasks.length * 88 + 48, height * 0.45, 380)] }), overflow: 'hidden' }} pointerEvents={expanded ? 'auto' : 'none'}>
      {expanded && <>
        <View style={[s.controls, { borderTopColor: c.border }]}>
          <Text style={[s.subtitle, { flex: 1, color: c.muted }]}>{tasks.length} files</Text>
          {uploads.tasks.some(t => pausableStates.has(t.status)) && <TouchableOpacity accessibilityRole="button" onPress={pauseAll} style={s.bulk}><Pause size={14} color={c.primary} /><Text style={[s.bulkText, { color: c.primary }]}>Pause all</Text></TouchableOpacity>}
          {paused > 0 || failed > 0 ? <TouchableOpacity accessibilityRole="button" onPress={resumeAll} style={s.bulk}><Play size={14} color={c.primary} /><Text style={[s.bulkText, { color: c.primary }]}>Resume all</Text></TouchableOpacity> : null}
        </View>
        <FlatList data={tasks} keyExtractor={t => `${t._type}:${t.id}`} initialNumToRender={5} maxToRenderPerBatch={6} style={{ flex: 1 }} renderItem={({ item }) => <TaskRow task={item} onCancel={item._type === 'upload' ? uploads.cancelUpload : downloads.cancelDownload} onPause={uploads.pauseUpload} onResume={uploads.resumeUpload} />} />
      </>}
    </Animated.View>
  </View>;
}
const s = StyleSheet.create({
  container: { position: 'absolute', borderRadius: 20, overflow: 'hidden', borderWidth: 1, elevation: 6, shadowColor: '#18223A', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 14, zIndex: 999 },
  header: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 4, minHeight: 68 },
  headerMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  headerIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 14, fontFamily: 'Inter_600SemiBold' }, subtitle: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 3 },
  iconBtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  controls: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderTopWidth: 1, minHeight: 44 },
  bulk: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, minHeight: 44 }, bulkText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 4, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 80 },
  rowIcon: { width: 36, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  rowInfo: { flex: 1, minWidth: 0 }, rowName: { fontSize: 12, fontFamily: 'Inter_600SemiBold' }, rowStatus: { fontSize: 10, lineHeight: 15, marginTop: 4, fontFamily: 'Inter_400Regular' },
  track: { height: 3, borderRadius: 3, overflow: 'hidden', marginTop: 8 }
});
