/**
 * UploadProgress.tsx
 *
 * Single upload task card.
 * Shows real byte-accurate progress, animated bar, and action buttons.
 */

import React, { useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Animated,
} from 'react-native';
import {
    X, CloudUpload, CheckCircle, AlertCircle,
    Pause, Play, RotateCcw, Clock, Loader, Copy,
} from 'lucide-react-native';

import { UploadTask } from '../services/UploadManager';
import { theme } from '../ui/theme';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
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

    const animProgress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(animProgress, {
            toValue: progress / 100,
            duration: 250,
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

    const canPause = (isUploading || isQueued || isRetrying) && !!onPause;
    const canResume = (isPaused || isFailed) && !!onResume;
    const canRetry = isFailed && !!onRetry;
    const canCancel = !isCompleted && !isCancelled;

    const getStatusLabel = (): string => {
        switch (status) {
            case 'uploading':
                return `${progress}% \u00B7 ${formatFileSize(bytesUploaded ?? 0)} / ${formatFileSize(file.size)}`;
            case 'queued': return 'Queued';
            case 'retrying': return `Retrying\u2026 (${task.retryCount})`;
            case 'paused':
                return `Paused \u00B7 ${formatFileSize(bytesUploaded ?? 0)} / ${formatFileSize(file.size)}`;
            case 'completed':
                return task.duplicate ? 'Already exists \u2713' : 'Uploaded \u2713';
            case 'failed': return task.error || 'Failed';
            case 'cancelled': return 'Cancelled';
            default: return 'Pending';
        }
    };

    const StatusIcon = () => {
        if (isCompleted && task.duplicate) return <Copy size={16} color={theme.colors.info} />;
        if (isCompleted) return <CheckCircle size={16} color={theme.colors.success} />;
        if (isFailed) return <AlertCircle size={16} color={theme.colors.error} />;
        if (isPaused) return <Pause size={16} color={theme.colors.warning} />;
        if (isCancelled) return <X size={16} color={theme.colors.neutral[500]} />;
        if (isRetrying) return <Loader size={16} color={theme.colors.warning} />;
        if (isQueued) return <Clock size={16} color={theme.colors.neutral[500]} />;
        return <CloudUpload size={16} color={theme.colors.primary} />;
    };

    const progressColor = isCompleted
        ? (task.duplicate ? theme.colors.info : theme.colors.success)
        : isFailed ? theme.colors.error
            : isPaused ? theme.colors.warning
                : theme.colors.primary;

    return (
        <View style={styles.card}>
            <View style={styles.header}>
                <View style={styles.info}>
                    <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
                    <View style={styles.statusRow}>
                        <StatusIcon />
                        <Text
                            style={[
                                styles.statusText,
                                isFailed && styles.statusError,
                                isCompleted && !task.duplicate && styles.statusSuccess,
                                isCompleted && task.duplicate && styles.statusDuplicate,
                                isPaused && styles.statusPaused,
                            ]}
                            numberOfLines={1}
                        >
                            {getStatusLabel()}
                        </Text>
                    </View>
                </View>
                <View style={styles.actions}>
                    {canPause && (
                        <TouchableOpacity
                            onPress={() => onPause!(task.id)}
                            style={styles.iconBtn}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Pause upload"
                        >
                            <Pause size={17} color={theme.colors.neutral[500]} />
                        </TouchableOpacity>
                    )}
                    {canResume && !canRetry && (
                        <TouchableOpacity
                            onPress={() => onResume!(task.id)}
                            style={[styles.iconBtn, styles.resumeBtn]}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Resume upload"
                        >
                            <Play size={17} color={theme.colors.primary} />
                        </TouchableOpacity>
                    )}
                    {canRetry && (
                        <TouchableOpacity
                            onPress={() => onRetry!(task.id)}
                            style={[styles.iconBtn, styles.resumeBtn]}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Retry upload"
                        >
                            <RotateCcw size={17} color={theme.colors.primary} />
                        </TouchableOpacity>
                    )}
                    {canCancel && (
                        <TouchableOpacity
                            onPress={() => onCancel(task.id)}
                            style={[styles.iconBtn, styles.cancelBtn]}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Cancel upload"
                        >
                            <X size={17} color={theme.colors.error} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>
            <View style={styles.progressTrack}>
                <Animated.View
                    style={[
                        styles.progressFill,
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
            <Text style={styles.sizeText}>{formatFileSize(file.size)}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        backgroundColor: theme.colors.card,
        borderRadius: theme.radius.card,
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.md,
        ...theme.shadows.elevation1,
        borderWidth: 1,
        borderColor: theme.colors.neutral[100],
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: theme.spacing.md,
        gap: theme.spacing.sm,
    },
    info: {
        flex: 1,
        gap: 4,
        minWidth: 0,
    },
    fileName: {
        fontSize: theme.typography.body.fontSize,
        fontWeight: theme.typography.subtitle.fontWeight,
        color: theme.colors.neutral[900],
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '600',
        color: theme.colors.primary,
        flexShrink: 1,
    },
    statusError: { color: theme.colors.error },
    statusSuccess: { color: theme.colors.success },
    statusDuplicate: { color: theme.colors.info },
    statusPaused: { color: theme.colors.warning },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    iconBtn: {
        padding: theme.spacing.sm,
        borderRadius: theme.radius.md,
        backgroundColor: theme.colors.neutral[50],
    },
    resumeBtn: {
        backgroundColor: theme.colors.primaryLight,
    },
    cancelBtn: {
        backgroundColor: `${theme.colors.error}1A`, // 10% opacity equivalent
    },
    progressTrack: {
        height: 6,
        borderRadius: theme.radius.full,
        backgroundColor: theme.colors.neutral[100],
        overflow: 'hidden',
        marginBottom: 6,
    },
    progressFill: {
        height: '100%',
        borderRadius: theme.radius.full,
    },
    sizeText: {
        fontSize: theme.typography.metadata.fontSize,
        color: theme.colors.neutral[500],
        fontWeight: theme.typography.metadata.fontWeight,
    },
});

export default React.memo(UploadProgress, (prev, next) => {
    return prev.task === next.task;
});
