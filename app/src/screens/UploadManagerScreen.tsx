import React, { useMemo, useRef, useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    SafeAreaView,
    TouchableOpacity,
    ScrollView,
} from 'react-native';
import { ArrowLeft, RotateCcw, Trash2, CloudUpload } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUpload } from '../context/UploadContext';
import UploadProgress from '../components/UploadProgress';
import { useTheme } from '../context/ThemeContext';

const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / (1024 ** index);
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const createStyles = (theme: any) => StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: theme.colors.background,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
    },
    iconBtn: {
        width: 42,
        height: 42,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerCenter: {
        flex: 1,
        marginLeft: 10,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '700',
        color: theme.colors.textHeading,
    },
    headerSub: {
        marginTop: 2,
        fontSize: 12,
        fontWeight: '500',
        color: theme.colors.textBody,
    },
    statsCard: {
        marginHorizontal: 20,
        marginTop: 14,
        padding: 16,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
    },
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    statsLabel: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.textBody,
        textTransform: 'uppercase',
    },
    statsValue: {
        fontSize: 13,
        fontWeight: '700',
        color: theme.colors.textHeading,
    },
    progressTrack: {
        height: 7,
        borderRadius: 999,
        overflow: 'hidden',
        backgroundColor: theme.colors.border,
        marginTop: 6,
    },
    progressFill: {
        height: '100%',
        borderRadius: 999,
        backgroundColor: theme.colors.primary,
    },
    actionsRow: {
        flexDirection: 'row',
        gap: 10,
        marginHorizontal: 20,
        marginTop: 12,
        marginBottom: 6,
    },
    actionBtn: {
        flex: 1,
        minHeight: 40,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    actionBtnText: {
        fontSize: 13,
        fontWeight: '700',
        color: theme.colors.textHeading,
    },
    sectionWrap: {
        flex: 1,
        marginTop: 8,
    },
    sectionTitle: {
        marginHorizontal: 20,
        marginBottom: 8,
        marginTop: 10,
        fontSize: 12,
        color: theme.colors.textBody,
        fontWeight: '700',
        textTransform: 'uppercase',
    },
    list: {
        paddingHorizontal: 20,
        paddingBottom: 100,
    },
    emptyWrap: {
        marginHorizontal: 20,
        marginTop: 20,
        padding: 30,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyTxt: {
        color: theme.colors.textBody,
        fontSize: 15,
        fontWeight: '500',
        marginTop: 12,
    },
});

export default function UploadManagerScreen({ navigation }: any) {
    const insets = useSafeAreaInsets();
    const { theme } = useTheme();
    const s = useMemo(() => createStyles(theme), [theme]);

    const {
        tasks,
        totalFiles,
        uploadedCount,
        failedCount,
        queuedCount,
        uploadingCount,
        overallProgress,
        uploadedBytes,
        totalBytes,
        cancelUpload,
        pauseUpload,
        resumeUpload,
        retryFailed,
        clearCompleted,
        cancelAll,
    } = useUpload();

    const activeTasks = useMemo(
        () => tasks.filter((t) => ['preparing', 'queued', 'uploading', 'processing', 'retrying', 'waiting_retry', 'paused'].includes(t.status)),
        [tasks]
    );
    const failedTasks = useMemo(() => tasks.filter((t) => t.status === 'failed'), [tasks]);
    const completedTasks = useMemo(() => tasks.filter((t) => t.status === 'completed'), [tasks]);
    const cancelledTasks = useMemo(() => tasks.filter((t) => t.status === 'cancelled'), [tasks]);

    const hasAny = activeTasks.length > 0 || failedTasks.length > 0 || completedTasks.length > 0 || cancelledTasks.length > 0;

    const renderTask = (item: any) => (
        <UploadProgress
            key={item.id}
            task={item}
            onCancel={cancelUpload}
            onPause={pauseUpload}
            onResume={resumeUpload}
            onRetry={resumeUpload}
        />
    );

    const scrollRef = useRef<ScrollView>(null);
    useEffect(() => {
        const timer = setTimeout(() => {
            if (activeTasks.length > 0 && scrollRef.current) {
                scrollRef.current.scrollTo({ y: 0, animated: true });
            }
        }, 150);
        return () => clearTimeout(timer);
    }, []);

    return (
        <SafeAreaView style={[s.root, { paddingTop: Math.max(insets.top, 0) }]}>
            <View style={s.header}>
                <TouchableOpacity style={s.iconBtn} onPress={() => navigation.goBack()}>
                    <ArrowLeft size={22} color={theme.colors.textHeading} />
                </TouchableOpacity>
                <View style={s.headerCenter}>
                    <Text style={s.headerTitle}>Upload Manager</Text>
                    <Text style={s.headerSub}>{totalFiles} files • {uploadingCount} uploading • {queuedCount} queued</Text>
                </View>
            </View>

            <View style={s.statsCard}>
                <View style={s.statsRow}>
                    <Text style={s.statsLabel}>Overall progress</Text>
                    <Text style={s.statsValue}>{overallProgress}%</Text>
                </View>
                <View style={s.progressTrack}>
                    <View style={[s.progressFill, { width: `${overallProgress}%` }]} />
                </View>
                <View style={[s.statsRow, { marginTop: 10, marginBottom: 0 }]}>
                    <Text style={s.statsValue}>{formatBytes(uploadedBytes)} / {formatBytes(totalBytes)}</Text>
                    <Text style={s.statsValue}>{uploadedCount} done • {failedCount} failed</Text>
                </View>
            </View>

            <View style={s.actionsRow}>
                <TouchableOpacity style={s.actionBtn} onPress={retryFailed}>
                    <RotateCcw size={16} color={theme.colors.primary} />
                    <Text style={s.actionBtnText}>Retry Failed</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.actionBtn} onPress={clearCompleted}>
                    <Trash2 size={16} color={theme.colors.textBody} />
                    <Text style={s.actionBtnText}>Clear Completed</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.actionBtn} onPress={cancelAll}>
                    <Text style={[s.actionBtnText, { color: theme.colors.danger }]}>Cancel All</Text>
                </TouchableOpacity>
            </View>

            <View style={s.sectionWrap}>
                {!hasAny ? (
                    <View style={s.emptyWrap}>
                        <CloudUpload size={42} color={theme.colors.muted || theme.colors.border} />
                        <Text style={s.emptyTxt}>No uploads in manager yet.</Text>
                    </View>
                ) : (
                    <ScrollView ref={scrollRef} contentContainerStyle={s.list} showsVerticalScrollIndicator={false}>
                        {activeTasks.length > 0 && (
                            <>
                                <Text style={s.sectionTitle}>Active Uploads ({activeTasks.length})</Text>
                                {activeTasks.map(renderTask)}
                            </>
                        )}

                        {failedTasks.length > 0 && (
                            <>
                                <Text style={s.sectionTitle}>Failed Uploads ({failedTasks.length})</Text>
                                {failedTasks.map(renderTask)}
                            </>
                        )}

                        {completedTasks.length > 0 && (
                            <>
                                <Text style={s.sectionTitle}>Completed Uploads ({completedTasks.length})</Text>
                                {completedTasks.map(renderTask)}
                            </>
                        )}

                        {cancelledTasks.length > 0 && (
                            <>
                                <Text style={s.sectionTitle}>Cancelled Uploads ({cancelledTasks.length})</Text>
                                {cancelledTasks.map(renderTask)}
                            </>
                        )}
                    </ScrollView>
                )}
            </View>
        </SafeAreaView>
    );
}
