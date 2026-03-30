/**
 * UploadProgress.tsx
 *
 * Single upload task card — clean 3-row layout:
 *   Row 1: [StatusIcon] FileName              Progress%
 *   Row 2: ████████████████████░░░░░░░░░░░░░  (animated bar)
 *   Row 3: Size · Status                   [Pause] [Cancel]
 *
 * Button colors: Pause=gray, Cancel=red, Retry=blue, Resume=green
 */

import React, { useEffect, useRef, useMemo } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Animated,
} from 'react-native';
import {
    X, CloudUpload, CheckCircle, AlertCircle,
    Pause, Play, RotateCcw, Clock, Loader, Copy,
} from 'lucide-react-native';

import { UploadTask } from '../services/UploadManager';
import { useTheme } from '../context/ThemeContext';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface UploadProgressProps {
    task: UploadTask;
    onCancel: (id: string) => void;
    onPause?: (id: string) => void;
    onResume?: (id: string) => void;
    onRetry?: (id: string) => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

const UploadProgress: React.FC<UploadProgressProps> = ({
    task, onCancel, onPause, onResume, onRetry,
}) => {
    const { file, status, progress, bytesUploaded } = task;
    const { theme, isDark } = useTheme();

    const animProgress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(animProgress, {
            toValue: progress / 100,
            duration: 300,
            useNativeDriver: false,
        }).start();
    }, [progress]);

    const isUploading = status === 'uploading';
    const isQueued = status === 'queued';
    const isRetrying = status === 'retrying';
    const isPaused = status === 'paused';
    const isCompleted = status === 'completed';
    const isFailed = status === 'failed';
    const isCancelled = status === 'cancelled';
    const isWaitingRetry = status === 'waiting_retry';
    const isTerminal = isCompleted || isCancelled;

    const canPause = (isUploading || isQueued || isRetrying || isWaitingRetry) && !!onPause;
    const canResume = isPaused && !!onResume;
    const canRetry = isFailed && !!onRetry;
    const canCancel = !isTerminal;

    // ── Status label (no duplicate %) ──
    const statusLabel = useMemo((): string => {
        switch (status) {
            case 'uploading':
                return `${formatFileSize(bytesUploaded ?? 0)} / ${formatFileSize(file.size)}`;
            case 'queued': return 'Waiting in queue';
            case 'retrying': return `Retrying (attempt ${task.retryCount})`;
            case 'waiting_retry': return `Waiting to retry…`;
            case 'paused':
                return `Paused · ${formatFileSize(bytesUploaded ?? 0)} / ${formatFileSize(file.size)}`;
            case 'completed':
                return task.duplicate ? 'Duplicate — already exists' : 'Uploaded successfully';
            case 'failed': return task.error || 'Upload failed';
            case 'cancelled': return 'Cancelled';
            default: return 'Pending';
        }
    }, [status, bytesUploaded, file.size, task.retryCount, task.error, task.duplicate]);

    // ── Status icon ──
    const statusIcon = useMemo(() => {
        const size = 15;
        if (isCompleted && task.duplicate) return <Copy size={size} color={theme.colors.primary} />;
        if (isCompleted) return <CheckCircle size={size} color={theme.colors.success} />;
        if (isFailed) return <AlertCircle size={size} color={theme.colors.danger} />;
        if (isPaused) return <Pause size={size} color={theme.colors.accent} />;
        if (isCancelled) return <X size={size} color={theme.colors.muted} />;
        if (isRetrying || isWaitingRetry) return <Loader size={size} color={theme.colors.accent} />;
        if (isQueued) return <Clock size={size} color={theme.colors.muted} />;
        return <CloudUpload size={size} color={theme.colors.primary} />;
    }, [status, task.duplicate, theme, isDark]);

    // ── Progress bar color ──
    const progressColor = isCompleted
        ? (task.duplicate ? theme.colors.primary : theme.colors.success)
        : isFailed ? theme.colors.danger
            : isPaused ? theme.colors.accent
                : theme.colors.primary;

    // ── Progress % display ──
    const showPercent = isUploading || isRetrying || isPaused || isWaitingRetry;
    const statusColor = isFailed ? theme.colors.danger
        : isCompleted && !task.duplicate ? theme.colors.success
            : isCompleted && task.duplicate ? theme.colors.primary
                : isPaused ? theme.colors.accent
                    : theme.colors.textBody;

    const s = useMemo(() => createStyles(theme, isDark), [theme, isDark]);

    return (
        <View style={s.card}>
            {/* Row 1: Icon + Name + % */}
            <View style={s.row1}>
                <View style={s.iconWrap}>{statusIcon}</View>
                <Text style={s.fileName} numberOfLines={1}>{file.name}</Text>
                {showPercent && (
                    <Text style={s.percent}>{progress}%</Text>
                )}
            </View>

            {/* Row 2: Progress bar */}
            {!isTerminal && (
                <View style={s.progressTrack}>
                    <Animated.View
                        style={[
                            s.progressFill,
                            {
                                backgroundColor: progressColor,
                                width: animProgress.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: ['0%', '100%'],
                                }),
                            },
                        ]}
                    />
                </View>
            )}

            {/* Row 3: Status + Actions */}
            <View style={s.row3}>
                <Text style={[s.statusText, { color: statusColor }]} numberOfLines={1}>
                    {statusLabel}
                </Text>
                <View style={s.actions}>
                    {canResume && (
                        <TouchableOpacity
                            onPress={() => onResume!(task.id)}
                            style={[s.actionBtn, { backgroundColor: `${theme.colors.success}18` }]}
                            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                            accessibilityLabel="Resume upload"
                        >
                            <Play size={15} color={theme.colors.success} />
                        </TouchableOpacity>
                    )}
                    {canRetry && (
                        <TouchableOpacity
                            onPress={() => onRetry!(task.id)}
                            style={[s.actionBtn, { backgroundColor: `${theme.colors.primary}18` }]}
                            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                            accessibilityLabel="Retry upload"
                        >
                            <RotateCcw size={15} color={theme.colors.primary} />
                        </TouchableOpacity>
                    )}
                    {canPause && (
                        <TouchableOpacity
                            onPress={() => onPause!(task.id)}
                            style={[s.actionBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)' }]}
                            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                            accessibilityLabel="Pause upload"
                        >
                            <Pause size={15} color={theme.colors.muted} />
                        </TouchableOpacity>
                    )}
                    {canCancel && (
                        <TouchableOpacity
                            onPress={() => onCancel(task.id)}
                            style={[s.actionBtn, { backgroundColor: `${theme.colors.danger}14` }]}
                            hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                            accessibilityLabel="Cancel upload"
                        >
                            <X size={15} color={theme.colors.danger} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>
        </View>
    );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const createStyles = (theme: any, isDark: boolean) => StyleSheet.create({
    card: {
        backgroundColor: theme.colors.card,
        borderRadius: 16,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
    },
    row1: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 10,
    },
    iconWrap: {
        width: 28,
        height: 28,
        borderRadius: 8,
        backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    fileName: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
        color: theme.colors.textHeading,
    },
    percent: {
        fontSize: 14,
        fontWeight: '700',
        color: theme.colors.primary,
        minWidth: 38,
        textAlign: 'right',
    },
    progressTrack: {
        height: 5,
        borderRadius: 999,
        backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : theme.colors.border,
        overflow: 'hidden',
        marginBottom: 10,
    },
    progressFill: {
        height: '100%',
        borderRadius: 999,
    },
    row3: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '500',
        flex: 1,
        minWidth: 0,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    actionBtn: {
        width: 34,
        height: 34,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
});

export default React.memo(UploadProgress, (prev, next) => {
    return prev.task === next.task;
});
