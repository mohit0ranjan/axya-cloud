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
import { theme as staticTheme } from '../ui/theme';
import { useTheme } from '../context/ThemeContext';

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
    const { theme } = useTheme();

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
        if (isCompleted && task.duplicate) return <Copy size={16} color={theme.colors.primary} />;
        if (isCompleted) return <CheckCircle size={16} color={theme.colors.success} />;
        if (isFailed) return <AlertCircle size={16} color={theme.colors.danger} />;
        if (isPaused) return <Pause size={16} color={theme.colors.accent} />;
        if (isCancelled) return <X size={16} color={theme.colors.muted} />;
        if (isRetrying) return <Loader size={16} color={theme.colors.accent} />;
        if (isQueued) return <Clock size={16} color={theme.colors.muted} />;
        return <CloudUpload size={16} color={theme.colors.primary} />;
    };

    const progressColor = isCompleted
        ? (task.duplicate ? theme.colors.primary : theme.colors.success)
        : isFailed ? theme.colors.danger
            : isPaused ? theme.colors.accent
                : theme.colors.primary;

    return (
        <View style={[styles.card, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
            <View style={styles.header}>
                <View style={styles.info}>
                    <Text style={[styles.fileName, { color: theme.colors.textHeading }]} numberOfLines={1}>{file.name}</Text>
                    <View style={styles.statusRow}>
                        <StatusIcon />
                        <Text
                            style={[
                                styles.statusText,
                                { color: theme.colors.primary },
                                isFailed && { color: theme.colors.danger },
                                isCompleted && !task.duplicate && { color: theme.colors.success },
                                isCompleted && task.duplicate && { color: theme.colors.primary },
                                isPaused && { color: theme.colors.accent },
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
                            style={[styles.iconBtn, { backgroundColor: theme.colors.inputBg }]}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Pause upload"
                        >
                            <Pause size={17} color={theme.colors.muted} />
                        </TouchableOpacity>
                    )}
                    {canResume && !canRetry && (
                        <TouchableOpacity
                            onPress={() => onResume!(task.id)}
                            style={[styles.iconBtn, { backgroundColor: theme.colors.primaryLight }]}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Resume upload"
                        >
                            <Play size={17} color={theme.colors.primary} />
                        </TouchableOpacity>
                    )}
                    {canRetry && (
                        <TouchableOpacity
                            onPress={() => onRetry!(task.id)}
                            style={[styles.iconBtn, { backgroundColor: theme.colors.primaryLight }]}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Retry upload"
                        >
                            <RotateCcw size={17} color={theme.colors.primary} />
                        </TouchableOpacity>
                    )}
                    {canCancel && (
                        <TouchableOpacity
                            onPress={() => onCancel(task.id)}
                            style={[styles.iconBtn, { backgroundColor: `${theme.colors.danger}1A` }]}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Cancel upload"
                        >
                            <X size={17} color={theme.colors.danger} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
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
            <Text style={[styles.sizeText, { color: theme.colors.textBody }]}>{formatFileSize(file.size)}</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        borderRadius: staticTheme.radius.card,
        padding: staticTheme.spacing.lg,
        marginBottom: staticTheme.spacing.md,
        ...staticTheme.shadows.elevation1,
        borderWidth: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: staticTheme.spacing.md,
        gap: staticTheme.spacing.sm,
    },
    info: {
        flex: 1,
        gap: 4,
        minWidth: 0,
    },
    fileName: {
        fontSize: staticTheme.typography.body.fontSize,
        fontWeight: staticTheme.typography.subtitle.fontWeight,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '600',
        flexShrink: 1,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    iconBtn: {
        padding: staticTheme.spacing.sm,
        borderRadius: staticTheme.radius.md,
    },
    progressTrack: {
        height: 6,
        borderRadius: staticTheme.radius.full,
        overflow: 'hidden',
        marginBottom: 6,
    },
    progressFill: {
        height: '100%',
        borderRadius: staticTheme.radius.full,
    },
    sizeText: {
        fontSize: staticTheme.typography.metadata.fontSize,
        fontWeight: staticTheme.typography.metadata.fontWeight,
    },
});

export default React.memo(UploadProgress, (prev, next) => {
    return prev.task === next.task;
});
