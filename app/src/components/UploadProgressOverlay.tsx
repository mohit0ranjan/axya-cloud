/**
 * UploadProgressOverlay.tsx
 *
 * Persistent floating panel showing all upload activity with real stats.
 *
 * Stats section shows: Total | Uploaded | Queued | Failed | Overall %
 * No hardcoded success text -- all values are derived from real task state.
 * Smooth animated expand/collapse.
 */

import React, { useState, useCallback, useRef } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    Animated, Dimensions, FlatList,
} from 'react-native';
import { ChevronUp, ChevronDown, RotateCcw, Trash2 } from 'lucide-react-native';
import { useUpload } from '../context/UploadContext';
import UploadProgress from './UploadProgress';

const { height } = Dimensions.get('window');

const C = {
    primary: '#4B6EF5',
    text: '#1A1F36',
    muted: '#8892A4',
    bg: '#FFFFFF',
    border: '#F1F3F9',
    success: '#1FD45A',
    danger: '#EF4444',
    warn: '#F59E0B',
};

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}

export default function UploadProgressOverlay() {
    const {
        tasks,
        cancelUpload, pauseUpload, resumeUpload, retryFailed, clearCompleted,
        totalFiles, uploadedCount, queuedCount, failedCount,
        activeCount, overallProgress, totalBytes, uploadedBytes,
    } = useUpload();

    const [expanded, setExpanded] = useState(false);
    const expandAnim = useRef(new Animated.Value(0)).current;

    // Don't render if no tasks
    if (tasks.length === 0) return null;

    const allDone = totalFiles > 0 && activeCount === 0;
    const hasFailed = failedCount > 0;
    const dedupCount = tasks.filter(t => t.duplicate).length;

    const headerTitle = activeCount > 0
        ? `Uploading ${activeCount} file${activeCount > 1 ? 's' : ''}\u2026`
        : allDone
            ? hasFailed
                ? 'Some uploads failed'
                : 'All uploads complete'
            : 'Upload queue';

    const headerSub = activeCount > 0
        ? `${overallProgress}% \u00B7 ${formatBytes(uploadedBytes)} / ${formatBytes(totalBytes)}`
        : `${uploadedCount} done \u00B7 ${failedCount} failed \u00B7 ${queuedCount} queued \u00B7 ${totalFiles} total`;

    const toggleExpand = useCallback(() => {
        const toValue = expanded ? 0 : 1;
        setExpanded(!expanded);
        Animated.spring(expandAnim, {
            toValue,
            tension: 65,
            friction: 10,
            useNativeDriver: false,
        }).start();
    }, [expanded]);

    const expandedHeight = expandAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, Math.min(tasks.length * 110 + 80, height * 0.55)],
    });

    // Stable callbacks for child cards
    const handleRetry = useCallback((id: string) => resumeUpload(id), [resumeUpload]);

    return (
        <Animated.View style={s.container}>
            {/* ── Header ─────────────────────────────────────────────────── */}
            <TouchableOpacity
                style={s.header}
                onPress={toggleExpand}
                activeOpacity={0.9}
            >
                <View style={s.headerInfo}>
                    <Text style={s.headerTitle} numberOfLines={1}>{headerTitle}</Text>
                    <Text style={s.headerSub} numberOfLines={1}>{headerSub}</Text>
                </View>
                <View style={s.headerActions}>
                    {hasFailed && (
                        <TouchableOpacity style={s.actionBtn} onPress={retryFailed}>
                            <RotateCcw color={C.primary} size={16} />
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity style={s.expandBtn} onPress={toggleExpand}>
                        {expanded
                            ? <ChevronDown color={C.text} size={22} />
                            : <ChevronUp color={C.text} size={22} />
                        }
                    </TouchableOpacity>
                </View>
            </TouchableOpacity>

            {/* ── Global progress bar ────────────────────────────────────── */}
            <View style={s.mainProgressTrack}>
                <Animated.View
                    style={[
                        s.mainProgressFill,
                        {
                            width: `${overallProgress}%`,
                            backgroundColor: hasFailed ? C.warn : (allDone ? C.success : C.primary),
                        },
                    ]}
                />
            </View>

            {/* ── Stats row (always visible) ─────────────────────────────── */}
            <View style={s.statsRow}>
                <StatPill label="Total" value={totalFiles} color={C.text} />
                <StatPill label="Done" value={uploadedCount} color={C.success} />
                <View style={dedupCount === 0 ? s.hiddenPill : undefined}>
                    <StatPill label="Dedup" value={dedupCount} color="#06B6D4" />
                </View>
                <StatPill label="Queued" value={queuedCount} color={C.primary} />
                <StatPill label="Failed" value={failedCount} color={C.danger} />
                <StatPill label="%" value={`${overallProgress}%`} color={C.primary} bold />
            </View>

            {/* ── Expanded: file list ────────────────────────────────────── */}
            <Animated.View style={{ height: expandedHeight, overflow: 'hidden' }}>
                <View style={s.listContainer}>
                    <View style={s.listHeader}>
                        <Text style={s.listTitle}>Upload Queue</Text>
                        <TouchableOpacity
                            onPress={clearCompleted}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            style={s.clearBtn}
                        >
                            <Trash2 size={14} color={C.muted} />
                            <Text style={s.clearBtnTxt}>Clear done</Text>
                        </TouchableOpacity>
                    </View>
                    <FlatList
                        data={tasks}
                        keyExtractor={t => t.id}
                        renderItem={({ item }) => (
                            <UploadProgress
                                task={item}
                                onCancel={cancelUpload}
                                onPause={pauseUpload}
                                onResume={resumeUpload}
                                onRetry={handleRetry}
                            />
                        )}
                        contentContainerStyle={s.list}
                        showsVerticalScrollIndicator={false}
                    />
                </View>
            </Animated.View>
        </Animated.View>
    );
}

// ── Stat pill sub-component ──────────────────────────────────────────────────

function StatPill({
    label, value, color, bold,
}: {
    label: string; value: number | string; color: string; bold?: boolean;
}) {
    return (
        <View style={s.statPill}>
            <Text style={s.statLabel}>{label}</Text>
            <Text style={[s.statValue, { color }, bold && { fontWeight: '800' }]}>
                {value}
            </Text>
        </View>
    );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 90,
        left: 15,
        right: 15,
        backgroundColor: C.bg,
        borderRadius: 24,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
        elevation: 12,
        zIndex: 1000,
        borderWidth: 1,
        borderColor: C.border,
    },
    header: {
        height: 66,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        justifyContent: 'space-between',
    },
    headerInfo: {
        flex: 1,
        minWidth: 0,
    },
    headerTitle: {
        fontSize: 15,
        fontWeight: '800',
        color: C.text,
    },
    headerSub: {
        fontSize: 12,
        color: C.muted,
        marginTop: 2,
        fontWeight: '600',
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    actionBtn: {
        padding: 6,
        backgroundColor: '#EEF1FD',
        borderRadius: 10,
    },
    expandBtn: {
        padding: 4,
        backgroundColor: '#F8F9FC',
        borderRadius: 12,
    },
    mainProgressTrack: {
        height: 4,
        backgroundColor: '#F4F6FB',
        width: '100%',
    },
    mainProgressFill: {
        height: 4,
    },
    // ── Stats row ────────────────────────────────────────────────────────────
    statsRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F4F6FB',
    },
    statPill: {
        alignItems: 'center',
        gap: 2,
    },
    statLabel: {
        fontSize: 10,
        fontWeight: '600',
        color: C.muted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    statValue: {
        fontSize: 15,
        fontWeight: '700',
    },
    // ── List ─────────────────────────────────────────────────────────────────
    listContainer: {
        flex: 1,
        padding: 16,
    },
    listHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 14,
        paddingHorizontal: 4,
    },
    listTitle: {
        fontSize: 16,
        fontWeight: '800',
        color: C.text,
    },
    clearBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        padding: 6,
        borderRadius: 8,
        backgroundColor: '#F8F9FC',
    },
    clearBtnTxt: {
        fontSize: 12,
        fontWeight: '600',
        color: C.muted,
    },
    list: {
        paddingBottom: 20,
    },
    // Always reserve space for Dedup pill to prevent layout shift (Fix M3)
    hiddenPill: {
        opacity: 0,
        pointerEvents: 'none' as const,
    },
});
