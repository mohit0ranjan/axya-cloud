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
        if (isCompleted && task.duplicate) return <Copy size={14} color="#06B6D4" />;
        if (isCompleted) return <CheckCircle size={14} color="#1FD45A" />;
        if (isFailed) return <AlertCircle size={14} color="#EF4444" />;
        if (isPaused) return <Pause size={14} color="#F59E0B" />;
        if (isCancelled) return <X size={14} color="#8892A4" />;
        if (isRetrying) return <Loader size={14} color="#F59E0B" />;
        if (isQueued) return <Clock size={14} color="#8892A4" />;
        return <CloudUpload size={14} color="#4B6EF5" />;
    };

    const progressColor = isCompleted
        ? (task.duplicate ? '#06B6D4' : '#1FD45A')
        : isFailed ? '#EF4444'
            : isPaused ? '#F59E0B'
                : '#4B6EF5';

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
                            <Pause size={17} color="#8892A4" />
                        </TouchableOpacity>
                    )}
                    {canResume && !canRetry && (
                        <TouchableOpacity
                            onPress={() => onResume!(task.id)}
                            style={[styles.iconBtn, styles.resumeBtn]}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Resume upload"
                        >
                            <Play size={17} color="#4B6EF5" />
                        </TouchableOpacity>
                    )}
                    {canRetry && (
                        <TouchableOpacity
                            onPress={() => onRetry!(task.id)}
                            style={[styles.iconBtn, styles.resumeBtn]}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Retry upload"
                        >
                            <RotateCcw size={17} color="#4B6EF5" />
                        </TouchableOpacity>
                    )}
                    {canCancel && (
                        <TouchableOpacity
                            onPress={() => onCancel(task.id)}
                            style={[styles.iconBtn, styles.cancelBtn]}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Cancel upload"
                        >
                            <X size={17} color="#EF4444" />
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
        backgroundColor: '#fff',
        borderRadius: 20,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#1A1F36',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.07,
        shadowRadius: 10,
        elevation: 3,
        borderWidth: 1,
        borderColor: '#F1F3F9',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
        gap: 8,
    },
    info: {
        flex: 1,
        gap: 4,
        minWidth: 0,
    },
    fileName: {
        fontSize: 14,
        fontWeight: '700',
        color: '#1A1F36',
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
    },
    statusText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#4B6EF5',
        flexShrink: 1,
    },
    statusError: { color: '#EF4444' },
    statusSuccess: { color: '#1FD45A' },
    statusDuplicate: { color: '#06B6D4' },
    statusPaused: { color: '#F59E0B' },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    iconBtn: {
        padding: 6,
        borderRadius: 10,
        backgroundColor: '#F8F9FC',
    },
    resumeBtn: {
        backgroundColor: '#EEF1FD',
    },
    cancelBtn: {
        backgroundColor: '#FEE2E2',
    },
    progressTrack: {
        height: 5,
        borderRadius: 10,
        backgroundColor: '#F4F6FB',
        overflow: 'hidden',
        marginBottom: 6,
    },
    progressFill: {
        height: '100%',
        borderRadius: 10,
    },
    sizeText: {
        fontSize: 11,
        color: '#8892A4',
        fontWeight: '500',
    },
});

export default React.memo(UploadProgress);
