/**
 * UploadProgress.tsx
 *
 * Single upload task card.
 * ✅ Progress bar reflects real progress from task.progress (0–100)
 * ✅ Shows bytes uploaded / total
 * ✅ Pause / Resume / Cancel buttons correctly state-gated
 * ✅ Retry button for failed tasks
 */

import React, { useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity, Animated,
} from 'react-native';
import {
    X, CloudUpload, CheckCircle, AlertCircle,
    Pause, Play, RotateCcw, Clock, Loader,
} from 'lucide-react-native';

import { UploadTask } from '../services/UploadManager';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes < 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface UploadProgressProps {
    task: UploadTask;
    onCancel: (id: string) => void;
    onPause?: (id: string) => void;
    onResume?: (id: string) => void;
    onRetry?: (id: string) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

const UploadProgress: React.FC<UploadProgressProps> = ({
    task, onCancel, onPause, onResume, onRetry,
}) => {
    const { status, progress, file, error, retryCount, bytesUploaded } = task;

    const isCompleted = status === 'completed';
    const isFailed = status === 'failed';
    const isPaused = status === 'paused';
    const isCancelled = status === 'cancelled';
    const isUploading = status === 'uploading';
    const isQueued = status === 'queued';
    const isRetrying = status === 'retrying';

    // ── Animated progress bar ─────────────────────────────────────────────
    const animProgress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(animProgress, {
            toValue: progress / 100,
            duration: 300,
            useNativeDriver: false,
        }).start();
    }, [progress]);

    // ── Status label / icon ───────────────────────────────────────────────
    const getStatusLabel = (): string => {
        if (isCompleted) return 'Upload complete';
        if (isFailed) return error || 'Upload failed';
        if (isCancelled) return 'Cancelled';
        if (isRetrying) return `Retrying… (${retryCount}/${3})`;
        if (isPaused) return `Paused · ${formatFileSize(bytesUploaded ?? 0)} / ${formatFileSize(file.size)}`;
        if (isQueued) return 'Waiting in queue…';
        if (isUploading) {
            const pct = Math.round(progress);
            const up = formatFileSize(bytesUploaded ?? 0);
            const total = formatFileSize(file.size);
            return `${pct}% · ${up} / ${total}`;
        }
        return `${Math.round(progress)}%`;
    };

    const barColor = isFailed
        ? '#EF4444'
        : isCompleted
            ? '#1FD45A'
            : isPaused
                ? '#F59E0B'
                : '#4B6EF5';

    const StatusIcon = () => {
        if (isCompleted) return <CheckCircle size={14} color="#1FD45A" />;
        if (isFailed) return <AlertCircle size={14} color="#EF4444" />;
        if (isPaused) return <Pause size={14} color="#F59E0B" />;
        if (isQueued) return <Clock size={14} color="#8892A4" />;
        if (isRetrying) return <Loader size={14} color="#F59E0B" />;
        return <CloudUpload size={14} color="#4B6EF5" />;
    };

    // ── Control buttons ───────────────────────────────────────────────────
    const canPause = (isUploading || isQueued || isRetrying) && !!onPause;
    const canResume = (isPaused || isFailed) && !!onResume;
    const canRetry = isFailed && !!onRetry;
    const canCancel = !isCompleted && !isCancelled;

    return (
        <View style={styles.card}>
            {/* ── Header ─────────────────────────────────────────────────── */}
            <View style={styles.header}>
                <View style={styles.info}>
                    <Text style={styles.fileName} numberOfLines={1}>
                        {file.name}
                    </Text>
                    <View style={styles.statusRow}>
                        <StatusIcon />
                        <Text
                            style={[
                                styles.statusText,
                                isFailed && styles.statusError,
                                isCompleted && styles.statusSuccess,
                                isPaused && styles.statusPaused,
                            ]}
                            numberOfLines={1}
                        >
                            {getStatusLabel()}
                        </Text>
                    </View>
                </View>

                {/* Action buttons */}
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

            {/* ── Progress bar ────────────────────────────────────────────── */}
            <View style={styles.progressTrack}>
                <Animated.View
                    style={[
                        styles.progressFill,
                        {
                            backgroundColor: barColor,
                            width: animProgress.interpolate({
                                inputRange: [0, 1],
                                outputRange: ['0%', '100%'],
                            }),
                        },
                    ]}
                />
            </View>

            {/* ── Size / file type pill ────────────────────────────────────── */}
            <Text style={styles.sizeText}>{formatFileSize(file.size)}</Text>
        </View>
    );
};

// ─── Styles ───────────────────────────────────────────────────────────────────

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
        minWidth: 0, // allow text truncation
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
