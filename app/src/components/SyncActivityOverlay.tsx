import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    Animated, Dimensions, FlatList, Alert, Platform,
} from 'react-native';
import {
    ChevronUp, ChevronDown, CheckCircle2, AlertTriangle, X,
    UploadCloud, DownloadCloud, Play, Pause, RefreshCcw, XCircle
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUpload } from '../context/UploadContext';
import { useDownload } from '../context/DownloadContext';
import { theme as staticTheme } from '../ui/theme';
import { useTheme } from '../context/ThemeContext';
import { UploadTask } from '../services/UploadManager';
import { DownloadTask } from '../services/DownloadManager';

const { height } = Dimensions.get('window');

function formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}

// ── Upload Item Row ───────────────────────────────────────────────────────────
const UpRow = React.memo(({ task, onCancel, onPause, onResume }: any) => {
    const { theme } = useTheme();
    const isActive = task.status === 'uploading' || task.status === 'queued';
    const isPaused = task.status === 'paused';
    const isFailed = task.status === 'failed';
    const isDone = task.status === 'completed';

    const color = isDone ? theme.colors.success : isFailed ? theme.colors.danger : theme.colors.primary;
    const label = isDone ? 'Done' : isFailed ? 'Failed' : isPaused ? 'Paused' : `${task.telegramProgressPercent}%`;

    return (
        <View style={s.row}>
            <View style={[s.rowIcon, { backgroundColor: `${color}18` }]}>
                <UploadCloud color={color} size={16} />
            </View>
            <View style={s.rowInfo}>
                <Text style={[s.rowName, { color: theme.colors.textHeading }]} numberOfLines={1}>{task.fileName}</Text>
                <View style={s.rowBottom}>
                    <View style={[s.progressTrack, { backgroundColor: theme.colors.border }]}>
                        <View style={[
                            s.progressFill,
                            { width: `${Math.max(task.telegramProgressPercent || 0, isDone ? 100 : 0)}%`, backgroundColor: color }
                        ]} />
                    </View>
                    <Text style={[s.rowStatus, { color }]}>{label}</Text>
                </View>
            </View>
            <View style={s.rowActions}>
                {isActive && (
                    <TouchableOpacity style={s.iconBtn} onPress={() => onPause(task.id)}>
                        <Pause color={theme.colors.muted} size={16} />
                    </TouchableOpacity>
                )}
                {(isPaused || isFailed) && (
                    <TouchableOpacity style={s.iconBtn} onPress={() => onResume(task.id)}>
                        {isFailed ? <RefreshCcw color={theme.colors.muted} size={16} /> : <Play color={theme.colors.muted} size={16} />}
                    </TouchableOpacity>
                )}
                <TouchableOpacity style={s.iconBtn} onPress={() => onCancel(task.id)}>
                    <X color={theme.colors.muted} size={16} />
                </TouchableOpacity>
            </View>
        </View>
    );
});

// ── Download Item Row ─────────────────────────────────────────────────────────
const DownRow = React.memo(({ task, onCancel }: any) => {
    const { theme } = useTheme();
    const isActive = task.status === 'downloading' || task.status === 'queued';
    const isFailed = task.status === 'failed';
    const isDone = task.status === 'completed';

    const color = isDone ? theme.colors.success : isFailed ? theme.colors.danger : theme.colors.primary;
    const label = isDone ? 'Done' : isFailed ? 'Failed' : `${task.progress}%`;

    return (
        <View style={s.row}>
            <View style={[s.rowIcon, { backgroundColor: `${color}18` }]}>
                <DownloadCloud color={color} size={16} />
            </View>
            <View style={s.rowInfo}>
                <Text style={[s.rowName, { color: theme.colors.textHeading }]} numberOfLines={1}>{task.fileName}</Text>
                <View style={s.rowBottom}>
                    <View style={[s.progressTrack, { backgroundColor: theme.colors.border }]}>
                        <View style={[
                            s.progressFill,
                            { width: `${Math.max(task.progress, isDone ? 100 : 0)}%`, backgroundColor: color }
                        ]} />
                    </View>
                    <Text style={[s.rowStatus, { color }]}>{label}</Text>
                </View>
            </View>
            <View style={s.rowActions}>
                {isActive && (
                    <TouchableOpacity style={s.iconBtn} onPress={() => onCancel(task.id)}>
                        <X color={theme.colors.muted} size={16} />
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
});

// ── Main Unified Component ────────────────────────────────────────────────────
export default function SyncActivityOverlay() {
    const insets = useSafeAreaInsets();
    const { theme, isDark } = useTheme();

    // Upload Context
    const {
        tasks: upTasks, cancelUpload, pauseUpload, resumeUpload, cancelAll: cancelAllUploads, clearCompleted: clearUpFinished,
        activeCount: upActive, failedCount: upFailed, uploadedCount: upDone, queuedCount: upQueued,
        overallProgress: upProgress, retryFailed: retryUpFailed
    } = useUpload();

    // Download Context
    const {
        tasks: downTasks, cancelDownload, cancelAll: cancelAllDownloads, clearCompleted: clearDownFinished,
        activeCount: downActive, overallProgress: downProgress
    } = useDownload();

    // Local State
    const [isExpanded, setIsExpanded] = useState(false);
    const [isDismissed, setIsDismissed] = useState(false);
    
    // Animations
    const animExpand = useRef(new Animated.Value(0)).current;

    // Derived State
    const downFailed = useMemo(() => downTasks.filter(t => t.status === 'failed').length, [downTasks]);
    const downDone = useMemo(() => downTasks.filter(t => t.status === 'completed').length, [downTasks]);
    
    const totalActive = upActive + downActive + upQueued;
    const totalFailed = upFailed + downFailed;
    const totalDone = upDone + downDone;
    
    // Unified task list for expansion
    const allTasks = useMemo(() => {
        const arr: any[] = [];
        upTasks.forEach(t => { if (t.status !== 'cancelled') arr.push({ ...t, _type: 'upload' }) });
        downTasks.forEach(t => { if (t.status !== 'cancelled') arr.push({ ...t, _type: 'download' }) });
        // Sort active to top, then failed, then completed
        return arr.sort((a, b) => {
            const getScore = (status: string) => {
                if (status === 'uploading' || status === 'downloading') return 3;
                if (status === 'queued') return 2;
                if (status === 'failed') return 1;
                return 0; // completed
            };
            return getScore(b.status) - getScore(a.status);
        });
    }, [upTasks, downTasks]);

    const hasTasks = allTasks.length > 0;
    const isIdle = totalActive === 0;
    const hasFailed = totalFailed > 0;
    const isAllComplete = isIdle && totalDone > 0 && !hasFailed;

    // Reacting to new tasks
    const prevActive = useRef(totalActive);
    useEffect(() => {
        if (totalActive > prevActive.current) {
            setIsDismissed(false);
            if (isExpanded) toggleExpand(); // auto-collapse on new queue start for compact view
        }
        prevActive.current = totalActive;
    }, [totalActive]);

    // Auto-dismiss success
    useEffect(() => {
        let timer: any;
        if (isAllComplete && !isExpanded && hasTasks) {
            timer = setTimeout(() => {
                setIsDismissed(true);
            }, 3000);
        }
        return () => clearTimeout(timer);
    }, [isAllComplete, isExpanded, hasTasks]);

    // Toggles
    const toggleExpand = useCallback(() => {
        const next = !isExpanded;
        setIsExpanded(next);
        Animated.spring(animExpand, {
            toValue: next ? 1 : 0,
            tension: 65,
            friction: 10,
            useNativeDriver: false, // We animate height/opacity
        }).start();
    }, [isExpanded, animExpand]);

    const handleDismiss = useCallback(() => {
        if (totalActive > 0) {
            const msg = 'Cancel all active transfers?';
            if (Platform.OS === 'web') {
                if (window.confirm(msg)) {
                    cancelAllUploads();
                    cancelAllDownloads();
                    setIsDismissed(true);
                }
            } else {
                Alert.alert('Cancel Transfers', msg, [
                    { text: 'Keep running', style: 'cancel' },
                    { text: 'Cancel All', style: 'destructive', onPress: () => {
                        cancelAllUploads();
                        cancelAllDownloads();
                        setIsDismissed(true);
                    }}
                ]);
            }
        } else {
            setIsDismissed(true);
            clearUpFinished();
            clearDownFinished();
        }
    }, [totalActive, cancelAllUploads, cancelAllDownloads, clearUpFinished, clearDownFinished]);

    if (!hasTasks || isDismissed) return null;

    // Priority Theming
    const primaryColor = hasFailed ? theme.colors.danger : isAllComplete ? theme.colors.success : theme.colors.primary;
    
    // Header Text
    let headerText = '';
    let HeaderIcon = UploadCloud;
    if (hasFailed) {
        headerText = `${totalFailed} transfer${totalFailed > 1 ? 's' : ''} failed`;
        HeaderIcon = AlertTriangle;
    } else if (isAllComplete) {
        headerText = 'All transfers complete';
        HeaderIcon = CheckCircle2;
    } else {
        const pieces = [];
        if (upActive > 0) pieces.push(`Uploading ${upActive}`);
        if (downActive > 0) pieces.push(`Downloading ${downActive}`);
        if (upQueued > 0 && pieces.length === 0) pieces.push(`Queued ${upQueued}`);
        headerText = pieces.join(' • ');
        HeaderIcon = RefreshCcw;
    }

    // Weighted overall progress
    const activeUpStats = upActive > 0 ? upProgress : 0;
    const activeDownStats = downActive > 0 ? downProgress : 0;
    const activeDivisor = (upActive > 0 ? 1 : 0) + (downActive > 0 ? 1 : 0) || 1;
    const aggProgress = isAllComplete ? 100 : Math.round((activeUpStats + activeDownStats) / activeDivisor);

    const expandedHeight = animExpand.interpolate({
        inputRange: [0, 1],
        outputRange: [0, Math.min(allTasks.length * 62 + 60, height * 0.45)],
    });
    
    const expandedOpacity = animExpand.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0, 0, 1],
    });

    return (
        <View style={[
            s.container, 
            { backgroundColor: theme.colors.card, bottom: Math.max(insets.bottom, 16) + 80 },
            isDark && { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 16 }
        ]}>
            {/* Minimal Header (Always Visible) */}
            <TouchableOpacity 
                activeOpacity={0.8} 
                onPress={toggleExpand} 
                style={s.header}
            >
                <View style={s.headerLeft}>
                    <HeaderIcon color={primaryColor} size={18} />
                    <Text style={[s.headerTitle, { color: theme.colors.textHeading }]} numberOfLines={1}>
                        {headerText}
                    </Text>
                    {(!isAllComplete && !hasFailed) && (
                        <Text style={[s.headerSubtitle, { color: theme.colors.textBody }]}> • {aggProgress}%</Text>
                    )}
                </View>
                <View style={s.headerRight}>
                    {isExpanded ? <ChevronDown color={theme.colors.muted} size={20} /> : <ChevronUp color={theme.colors.muted} size={20} />}
                    <TouchableOpacity style={s.dismissBtn} onPress={handleDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <X color={theme.colors.muted} size={20} />
                    </TouchableOpacity>
                </View>
            </TouchableOpacity>

            {/* Simple Top Progress Bar */}
            {!isAllComplete && (
                <View style={[s.mainProgressTrack, { backgroundColor: theme.colors.border }]}>
                    <View style={[s.mainProgressFill, { width: `${aggProgress}%`, backgroundColor: primaryColor }]} />
                </View>
            )}

            {/* Expanded List View */}
            <Animated.View style={{ height: expandedHeight, opacity: expandedOpacity, overflow: 'hidden' }}>
                {hasFailed && (
                    <TouchableOpacity 
                        style={[s.retryAllBar, { backgroundColor: `${theme.colors.danger}18` }]} 
                        onPress={() => retryUpFailed()}
                    >
                        <RefreshCcw color={theme.colors.danger} size={14} />
                        <Text style={[s.retryAllText, { color: theme.colors.danger }]}>Retry Failed Uploads</Text>
                    </TouchableOpacity>
                )}
                <FlatList
                    data={allTasks}
                    keyExtractor={item => `${item._type}_${item.id}`}
                    renderItem={({ item }) => {
                        if (item._type === 'upload') {
                            return <UpRow task={item} onCancel={cancelUpload} onPause={pauseUpload} onResume={resumeUpload} />;
                        } else {
                            return <DownRow task={item} onCancel={cancelDownload} />;
                        }
                    }}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={s.listContent}
                />
            </Animated.View>
        </View>
    );
}

const s = StyleSheet.create({
    container: {
        position: 'absolute',
        left: staticTheme.spacing.lg,
        right: staticTheme.spacing.lg,
        borderRadius: staticTheme.radius.modal,
        overflow: 'hidden',
        zIndex: 1000,
        ...staticTheme.shadows.elevation2,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: staticTheme.spacing.lg,
        paddingVertical: 14,
        minHeight: 52,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        flex: 1,
    },
    headerTitle: {
        fontSize: 14,
        fontWeight: '600',
    },
    headerSubtitle: {
        fontSize: 13,
        fontWeight: '500',
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    dismissBtn: {
        padding: 4,
    },
    mainProgressTrack: {
        height: 2,
    },
    mainProgressFill: {
        height: 2,
    },
    listContent: {
        paddingHorizontal: staticTheme.spacing.md,
        paddingBottom: 16,
    },
    
    // Rows
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 8,
        gap: 12,
    },
    rowIcon: {
        width: 32,
        height: 32,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    rowInfo: { flex: 1, gap: 4 },
    rowName: { fontSize: 13, fontWeight: '600' },
    rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    progressTrack: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
    progressFill: { height: 4, borderRadius: 2 },
    rowStatus: { fontSize: 11, fontWeight: '600', minWidth: 40, textAlign: 'right' },
    rowActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    iconBtn: {
        padding: 6,
    },
    retryAllBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 10,
        marginHorizontal: 16,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(0,0,0,0.05)',
    },
    retryAllText: {
        fontSize: 13,
        fontWeight: '600',
    }
});
