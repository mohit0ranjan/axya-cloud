import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    Animated, Dimensions, FlatList, Alert, Platform,
} from 'react-native';
import {
    ChevronUp, ChevronDown, Check, AlertCircle, X,
    UploadCloud, Play, Pause, RefreshCcw
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUpload } from '../context/UploadContext';
import { useDownload } from '../context/DownloadContext';
import { useTheme } from '../context/ThemeContext';
import * as Progress from 'react-native-progress';

const { height } = Dimensions.get('window');

// ── Google Drive Style Compact Row ────────────────────────────────────────────
const TaskRow = React.memo(({ task, onCancel, onPause, onResume }: any) => {
    const { theme } = useTheme();
    const isActive = task.status === 'uploading' || task.status === 'queued' || task.status === 'preparing' || task.status === 'processing' || task.status === 'retrying' || task.status === 'waiting_retry';
    const isPaused = task.status === 'paused';
    const isFailed = task.status === 'failed';
    const isDone = task.status === 'completed';

    const color = isDone ? theme.colors.success : isFailed ? theme.colors.danger : theme.colors.primary;
    // Smooth translation of percent to decimal without jumping "0%" text
    const safeProgress = Number.isFinite(task.progress) ? Math.max(0, Math.min(task.progress / 100, 1)) : 0;
    const name = task.file?.name || task.fileName || 'Unknown file';

    // State String Fallbacks
    let label = 'Pending';
    if (isDone) label = 'Uploaded';
    else if (isFailed) label = 'Failed';
    else if (isPaused) label = 'Paused';
    else if (task.status === 'queued') label = 'Waiting to upload...';
    else if (task.status === 'processing') label = 'Finalizing...';
    else if (task.status === 'preparing') label = 'Starting...';
    else if (task.status === 'retrying' || task.status === 'waiting_retry') label = 'Network paused...';
    else if (task.status === 'uploading') {
        // Fallback: don't flash 0% string explicitly to user, keep it clean
        if (safeProgress === 0) label = 'Uploading...';
        else label = `Uploading...`;
    }

    return (
        <View style={s.row}>
            {/* Left standard file/status icon */}
            <View style={[s.rowIcon, { backgroundColor: isFailed ? `${theme.colors.danger}15` : isDone ? `${theme.colors.success}15` : theme.colors.background }]}>
                {isFailed ? <AlertCircle color={theme.colors.danger} size={18} /> : 
                 isDone ? <Check color={theme.colors.success} size={18} /> :
                 <UploadCloud color={theme.colors.muted} size={18} />}
            </View>
            
            <View style={s.rowInfo}>
                <Text style={[s.rowName, { color: theme.colors.textHeading }]} numberOfLines={1}>{name}</Text>
                <Text style={[s.rowStatus, { color: isFailed || isDone ? color : theme.colors.textBody }]} numberOfLines={1}>{label}</Text>
            </View>
            
            {/* Right Drive-style Actions */}
            <View style={s.rowActions}>
                {isActive && (
                    <View style={s.ringContainer}>
                         {/* Circle doubles as a visual and an action button */}
                        <Progress.Circle
                            size={28}
                            progress={task.status === 'queued' || task.status === 'preparing' ? undefined : safeProgress}
                            indeterminate={task.status === 'queued' || task.status === 'preparing' || task.status === 'processing'}
                            color={theme.colors.primary}
                            unfilledColor={theme.colors.border}
                            borderWidth={0}
                            thickness={3}
                            strokeCap="round"
                        />
                        <TouchableOpacity style={s.ringCancelBtn} onPress={() => onCancel(task.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                            <X color={theme.colors.muted} size={12} strokeWidth={3} />
                        </TouchableOpacity>
                    </View>
                )}
                {isPaused && (
                    <>
                        <TouchableOpacity style={s.iconBtn} onPress={() => onResume(task.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                            <Play fill={theme.colors.success} color={theme.colors.success} size={18} />
                        </TouchableOpacity>
                        <TouchableOpacity style={[s.iconBtn, { marginLeft: 12 }]} onPress={() => onCancel(task.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                            <X color={theme.colors.muted} size={20} />
                        </TouchableOpacity>
                    </>
                )}
                {(isFailed || isDone) && (
                    <TouchableOpacity style={s.iconBtn} onPress={() => onCancel(task.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <X color={theme.colors.muted} size={20} />
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );
});

// ── Main UI Component ────────────────────────────────────────────────────────────
export default function SyncActivityOverlay() {
    const insets = useSafeAreaInsets();
    const { theme, isDark } = useTheme();

    const {
        tasks: upTasks, cancelUpload, pauseUpload, resumeUpload, cancelAll: cancelAllUploads, clearCompleted: clearUpFinished,
        activeCount: upActive, failedCount: upFailed, uploadedCount: upDone, queuedCount: upQueued
    } = useUpload();

    const {
        tasks: downTasks, cancelDownload, cancelAll: cancelAllDownloads, clearCompleted: clearDownFinished,
        activeCount: downActive
    } = useDownload();

    const [isExpanded, setIsExpanded] = useState(false);
    const [isDismissed, setIsDismissed] = useState(false);
    const animExpand = useRef(new Animated.Value(0)).current;

    const downFailed = useMemo(() => downTasks.filter(t => t.status === 'failed').length, [downTasks]);
    const downDone = useMemo(() => downTasks.filter(t => t.status === 'completed').length, [downTasks]);
    
    const totalActive = upActive + downActive + upQueued;
    const totalFailed = upFailed + downFailed;
    const totalDone = upDone + downDone;
    
    // Sort logic places active/uploading -> preparing -> queued -> paused -> failed -> completed
    const allTasks = useMemo(() => {
        const arr: any[] = [];
        upTasks.forEach(t => { if (t.status !== 'cancelled') arr.push({ ...t, _type: 'upload' }) });
        downTasks.forEach(t => { if (t.status !== 'cancelled') arr.push({ ...t, _type: 'download' }) });
        return arr.sort((a, b) => {
            const getScore = (status: string) => {
                if (status === 'uploading' || status === 'processing' || status === 'downloading') return 5;
                if (status === 'preparing') return 4;
                if (status === 'queued') return 3;
                if (status === 'retrying' || status === 'waiting_retry' || status === 'paused') return 2;
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

    const prevActive = useRef(totalActive);
    useEffect(() => {
        if (totalActive > prevActive.current) {
            setIsDismissed(false);
            if (isExpanded) toggleExpand();
        }
        prevActive.current = totalActive;
    }, [totalActive]);

    // Google Drive auto-dismiss behavior on success
    useEffect(() => {
        let timer: any;
        if (isAllComplete && hasTasks) {
            timer = setTimeout(() => {
                setIsDismissed(true);
            }, 5000);
        }
        return () => clearTimeout(timer);
    }, [isAllComplete, hasTasks]);

    const toggleExpand = useCallback(() => {
        const next = !isExpanded;
        setIsExpanded(next);
        Animated.spring(animExpand, {
            toValue: next ? 1 : 0,
            tension: 50,
            friction: 8,
            useNativeDriver: false, // Animating Layout Dimensions
        }).start();
    }, [isExpanded, animExpand]);

    const handleDismiss = useCallback(() => {
        if (totalActive > 0) {
            const msg = 'Cancel all incoming and outgoing transfers?';
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

    const handlePauseAll = useCallback(() => {
        upTasks.forEach(t => {
            if (t.status === 'uploading' || t.status === 'queued' || t.status === 'preparing') pauseUpload(t.id);
        });
    }, [upTasks, pauseUpload]);

    const handleResumeAll = useCallback(() => {
        upTasks.forEach(t => {
            if (t.status === 'paused') resumeUpload(t.id);
        });
    }, [upTasks, resumeUpload]);

    if (!hasTasks || isDismissed) return null;

    let headerText = '';
    const itemsCount = allTasks.length;
    if (hasFailed) {
        headerText = `${totalFailed} upload${totalFailed > 1 ? 's' : ''} failed`;
    } else if (isAllComplete) {
        headerText = `Uploaded ${totalDone} file${totalDone > 1 ? 's' : ''}`;
    } else {
        headerText = `Uploading ${itemsCount} file${itemsCount > 1 ? 's' : ''}`;
    }

    // Determine circular animation for header progress indicator
    // Wait for all to finish, or show indeterminate spinner when computing queue
    const loadingTasks = [upActive, downActive, upQueued].reduce((acc, v) => acc + v, 0);

    const expandedHeight = animExpand.interpolate({
        inputRange: [0, 1],
        outputRange: [0, Math.min(allTasks.length * 64 + 40, height * 0.5)],
    });

    const expandedOpacity = animExpand.interpolate({
        inputRange: [0, 0.7, 1],
        outputRange: [0, 0, 1],
    });

    return (
        <View style={[
            s.container, 
            { backgroundColor: theme.colors.card, bottom: Math.max(insets.bottom, 16) + 80 },
            isDark && { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20 }
        ]}>
            {/* Google Drive Minimized Persistent Header */}
            <TouchableOpacity 
                activeOpacity={0.9} 
                onPress={toggleExpand} 
                style={s.header}
            >
                <View style={s.headerLeft}>
                    {/* Ring indicator immediately shows context */}
                    {hasFailed ? (
                        <AlertCircle color={theme.colors.danger} size={22} />
                    ) : isAllComplete ? (
                        <View style={[s.iconRound, { backgroundColor: theme.colors.success }]}>
                            <Check color={'#FFF'} size={14} strokeWidth={3} />
                        </View>
                    ) : (
                        <Progress.CircleSnail
                            color={theme.colors.primary}
                            size={22}
                            spinDuration={1200}
                            thickness={2}
                            direction="clockwise"
                        />
                    )}
                    <Text style={[s.headerTitle, { color: theme.colors.textHeading }]} numberOfLines={1}>
                        {headerText}
                    </Text>
                </View>
                <View style={s.headerRight}>
                    {isExpanded ? <ChevronDown color={theme.colors.muted} size={22} /> : <ChevronUp color={theme.colors.muted} size={22} />}
                    {loadingTasks > 0 && !isExpanded && (
                        <TouchableOpacity style={s.dismissBtn} onPress={handlePauseAll} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                            <Pause color={theme.colors.muted} size={20} />
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity style={s.dismissBtn} onPress={handleDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                        <X color={theme.colors.muted} size={20} />
                    </TouchableOpacity>
                </View>
            </TouchableOpacity>

            {/* List Drawer */}
            <Animated.View style={[s.listContainer, { height: expandedHeight, opacity: expandedOpacity }]}>
                {isExpanded && (
                    <View style={s.listHeaderControls}>
                        {loadingTasks > 0 && (
                            <TouchableOpacity style={s.bulkBtn} onPress={handlePauseAll}>
                                <Pause color={theme.colors.muted} size={14} style={{ marginRight: 6 }}/>
                                <Text style={[s.bulkText, { color: theme.colors.muted }]}>Pause All</Text>
                            </TouchableOpacity>
                        )}
                        {upTasks.some((t: any) => t.status === 'paused') && (
                            <TouchableOpacity style={s.bulkBtn} onPress={handleResumeAll}>
                                <Play color={theme.colors.success} size={14} style={{ marginRight: 6 }}/>
                                <Text style={[s.bulkText, { color: theme.colors.success }]}>Resume All</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                )}
                <FlatList
                    data={allTasks}
                    keyExtractor={t => t.id}
                    contentContainerStyle={{ paddingBottom: 16 }}
                    showsVerticalScrollIndicator={true}
                    renderItem={({ item }) => {
                        return <TaskRow 
                                  task={item} 
                                  onCancel={item._type === 'upload' ? cancelUpload : cancelDownload}
                                  onPause={pauseUpload} 
                                  onResume={resumeUpload} 
                               />;
                    }}
                />
            </Animated.View>
        </View>
    );
}

const s = StyleSheet.create({
    container: {
        position: 'absolute',
        left: 16,
        right: 16,
        borderRadius: 12,
        overflow: 'hidden',
        elevation: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        zIndex: 999,
        borderWidth: 1,
        borderColor: 'rgba(150,150,150,0.1)',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 14,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    iconRound: {
        width: 22,
        height: 22,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginLeft: 12,
        flexShrink: 1,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    dismissBtn: {
        marginLeft: 12,
        padding: 4,
    },
    listContainer: {
        width: '100%',
        backgroundColor: 'rgba(0,0,0,0.02)',
        borderTopWidth: 1,
        borderTopColor: 'rgba(150,150,150,0.08)',
    },
    listHeaderControls: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    bulkBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 6,
        backgroundColor: 'rgba(150,150,150,0.1)',
        marginLeft: 8,
    },
    bulkText: {
        fontSize: 12,
        fontWeight: '500',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    rowIcon: {
        width: 32,
        height: 32,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    rowInfo: {
        flex: 1,
        justifyContent: 'center',
    },
    rowName: {
        fontSize: 14,
        fontWeight: '500',
        marginBottom: 2,
    },
    rowStatus: {
        fontSize: 12,
    },
    rowActions: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 12,
    },
    iconBtn: {
        padding: 6,
    },
    ringContainer: {
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
    },
    ringCancelBtn: {
        position: 'absolute',
        alignItems: 'center',
        justifyContent: 'center',
        width: 28,
        height: 28,
    },
});
