import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    Animated, Dimensions, FlatList,
} from 'react-native';
import { ChevronUp, ChevronDown, Trash2, X, AlertTriangle, CheckCircle2 } from 'lucide-react-native';
import { useUpload } from '../context/UploadContext';
import UploadProgress from './UploadProgress';

const { height } = Dimensions.get('window');

const C = {
    primary: '#4B6EF5',
    text: '#111827', // darker gray for max contrast without being pure black
    muted: '#6B7280', // muted gray
    bg: '#FFFFFF',
    border: '#E5E7EB',
    success: '#10B981',
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
    const [isDismissed, setIsDismissed] = useState(false);
    const expandAnim = useRef(new Animated.Value(0)).current;

    // Un-dismiss when new files are added
    const prevTotal = useRef(totalFiles);
    useEffect(() => {
        if (totalFiles > prevTotal.current) {
            setIsDismissed(false);
        }
        prevTotal.current = totalFiles;
    }, [totalFiles]);

    // Auto-hide when everything is completely done without errors
    const allDone = totalFiles > 0 && activeCount === 0 && queuedCount === 0;
    const isPerfectSuccess = allDone && failedCount === 0;

    useEffect(() => {
        if (isPerfectSuccess) {
            // Auto dismiss after a short delay on perfect success
            const timer = setTimeout(() => {
                setIsDismissed(true);
            }, 3000);
            return () => clearTimeout(timer);
        }
    }, [isPerfectSuccess]);

    if (tasks.length === 0 || isDismissed) return null;

    const hasFailed = failedCount > 0;
    const dedupCount = tasks.filter(t => t.duplicate).length;
    const isErrorState = allDone && hasFailed;

    const toggleExpand = () => {
        const toValue = expanded ? 0 : 1;
        setExpanded(!expanded);
        Animated.spring(expandAnim, {
            toValue,
            tension: 65,
            friction: 10,
            useNativeDriver: false,
        }).start();
    };

    const handleDismiss = () => {
        setIsDismissed(true);
    };

    const expandedHeight = expandAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, Math.min(tasks.length * 110 + 80, height * 0.55)],
    });

    // Derived Display Logic
    const progressColor = hasFailed ? C.danger : (allDone ? C.success : C.primary);

    // Status text in banner
    let bannerTitle = '';
    let bannerIcon = null;

    if (hasFailed) {
        bannerTitle = `${failedCount} upload${failedCount > 1 ? 's' : ''} failed`;
        bannerIcon = <AlertTriangle color={C.danger} size={18} />;
    } else if (allDone) {
        bannerTitle = 'Uploads complete';
        bannerIcon = <CheckCircle2 color={C.success} size={18} />;
    } else {
        const remaining = activeCount + queuedCount;
        bannerTitle = `Uploading ${remaining} item${remaining > 1 ? 's' : ''}`;
    }

    return (
        <Animated.View style={s.container}>
            {/* ── Banner Header ─────────────────────────────────────────────────── */}
            <View style={s.header}>
                <TouchableOpacity style={s.headerTitleArea} onPress={toggleExpand} activeOpacity={0.7}>
                    {bannerIcon}
                    <Text style={[s.bannerTitle, hasFailed && { color: C.danger }]} numberOfLines={1}>
                        {bannerTitle}
                    </Text>
                    {expanded ? <ChevronDown color={C.muted} size={20} /> : <ChevronUp color={C.muted} size={20} />}
                </TouchableOpacity>

                <View style={s.headerActions}>
                    {hasFailed && (
                        <TouchableOpacity onPress={retryFailed} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
                            <Text style={s.primaryBtnText}>Retry All</Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={handleDismiss} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ padding: 4 }}>
                        <X color={C.muted} size={20} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* ── Global progress bar ────────────────────────────────────── */}
            <View style={s.mainProgressTrack}>
                <Animated.View
                    style={[
                        s.mainProgressFill,
                        {
                            width: `${overallProgress}%`,
                            backgroundColor: progressColor,
                        },
                    ]}
                />
            </View>

            {/* ── Compact Stats row (always visible) ─────────────────────────────── */}
            <TouchableOpacity activeOpacity={0.9} onPress={toggleExpand} style={s.statsRow}>
                <StatPill label="Total" value={totalFiles} color={C.text} />
                <StatPill label="Done" value={uploadedCount} color={C.success} />
                <View style={dedupCount === 0 ? s.hiddenPill : undefined}>
                    <StatPill label="Dedup" value={dedupCount} color={C.muted} />
                </View>
                <StatPill label="Queued" value={queuedCount} color={C.primary} />
                {hasFailed && <StatPill label="Failed" value={failedCount} color={C.danger} />}

                <View style={[s.statPill, { marginLeft: 'auto', alignItems: 'flex-end', paddingRight: 4 }]}>
                    <Text style={s.statLabel}>{isErrorState ? 'Status' : 'Progress'}</Text>
                    <Text style={[s.statValue, { color: progressColor }]}>
                        {isErrorState ? 'Errors' : `${overallProgress}%`}
                    </Text>
                </View>
            </TouchableOpacity>

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
                                onRetry={resumeUpload} // Map retry action directly to resume
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

const StatPill = React.memo(function StatPill({
    label, value, color
}: {
    label: string; value: number | string; color: string;
}) {
    return (
        <View style={s.statPill}>
            <Text style={s.statLabel}>{label}</Text>
            <Text style={[s.statValue, { color }]}>
                {value}
            </Text>
        </View>
    );
});

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 90,
        left: 16,
        right: 16,
        backgroundColor: '#FFFFFF',
        borderRadius: 16, // softer edges
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.08, // softer shadow
        shadowRadius: 24,
        elevation: 8,
    },
    header: {
        height: 54, // slightly compact header
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        justifyContent: 'space-between',
    },
    headerTitleArea: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        flex: 1,
    },
    bannerTitle: {
        fontSize: 15,
        fontWeight: '500', // medium instead of bold
        color: C.text,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    primaryBtnText: {
        color: C.primary,
        fontWeight: '500',
        fontSize: 14,
    },
    mainProgressTrack: {
        height: 3,
        backgroundColor: '#F3F4F6',
        width: '100%',
    },
    mainProgressFill: {
        height: 3,
    },
    // ── Stats row ────────────────────────────────────────────────────────────
    statsRow: {
        flexDirection: 'row',
        paddingVertical: 12,
        paddingHorizontal: 16,
        gap: 16,
        flexWrap: 'wrap',
    },
    statPill: {
        alignItems: 'flex-start',
        gap: 2,
    },
    statLabel: {
        fontSize: 12,
        fontWeight: '400', // regular text for labels
        color: C.muted,
    },
    statValue: {
        fontSize: 16, // matching UI scale
        fontWeight: '500', // medium instead of bold
    },
    // ── List ─────────────────────────────────────────────────────────────────
    listContainer: {
        flex: 1,
        padding: 16,
        paddingTop: 8,
        borderTopWidth: 1,
        borderTopColor: '#F3F4F6', // softer separate
    },
    listHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    listTitle: {
        fontSize: 14,
        fontWeight: '500',
        color: C.text,
    },
    clearBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        padding: 4,
    },
    clearBtnTxt: {
        fontSize: 12,
        fontWeight: '400',
        color: C.muted,
    },
    list: {
        paddingBottom: 20,
    },
    hiddenPill: {
        display: 'none',
    },
});
