import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    Animated, Dimensions, FlatList,
} from 'react-native';
import {
    ChevronUp, ChevronDown, CheckCircle2, AlertTriangle, X
} from 'lucide-react-native';
import { useUpload } from '../context/UploadContext';
import UploadProgress from './UploadProgress';
import { theme } from '../ui/theme';

const { height } = Dimensions.get('window');

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}

function UploadProgressOverlay() {
    const {
        tasks,
        cancelUpload, pauseUpload, resumeUpload, retryFailed, clearCompleted,
        totalFiles, uploadedCount, queuedCount, failedCount,
        activeCount, overallProgress, totalBytes, uploadedBytes,
    } = useUpload();

    const [isExpanded, setIsExpanded] = useState(false);
    const [isDismissed, setIsDismissed] = useState(false);
    const animHeight = useRef(new Animated.Value(0)).current; // 0 = collapsed, 1 = expanded
    const animFade = useRef(new Animated.Value(0)).current; // 0 = hidden, 1 = visible

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
        const MIN_HEIGHT = 0;
        const MAX_HEIGHT = Math.min(tasks.length * 110 + 80, height * 0.55); // Max height for list
        if (isExpanded) {
            Animated.parallel([
                Animated.timing(animHeight, {
                    toValue: MIN_HEIGHT,
                    duration: theme.motion.duration,
                    useNativeDriver: false,
                }),
                Animated.timing(animFade, {
                    toValue: 0,
                    duration: theme.motion.duration,
                    useNativeDriver: false,
                }),
            ]).start(() => setIsExpanded(false));
        } else {
            setIsExpanded(true);
            Animated.parallel([
                Animated.timing(animHeight, {
                    toValue: MAX_HEIGHT,
                    duration: theme.motion.duration,
                    useNativeDriver: false,
                }),
                Animated.timing(animFade, {
                    toValue: 1,
                    duration: theme.motion.duration,
                    useNativeDriver: false,
                }),
            ]).start();
        }
    };

    const handleDismiss = () => {
        setIsDismissed(true);
    };

    // Derived Display Logic
    const progressColor = hasFailed ? theme.colors.error : (allDone ? theme.colors.success : theme.colors.primary);

    // Status text in banner
    let bannerTitle = '';
    let bannerIcon = null;

    if (hasFailed) {
        bannerTitle = `${failedCount} upload${failedCount > 1 ? 's' : ''} failed`;
        bannerIcon = <AlertTriangle color={theme.colors.error} size={18} />;
    } else if (allDone) {
        bannerTitle = 'Uploads complete';
        bannerIcon = <CheckCircle2 color={theme.colors.success} size={18} />;
    } else {
        bannerTitle = `Uploading ${activeCount} item${activeCount > 1 ? 's' : ''}`;
    }

    const animProgressUI = animHeight.interpolate({
        inputRange: [0, 1],
        outputRange: [`${overallProgress}%`, `${overallProgress}%`],
    });

    return (
        <Animated.View style={s.container}>
            {/* ── Banner Header ─────────────────────────────────────────────────── */}
            <View style={s.bannerRow}>
                <View style={s.bannerLeft}>
                    {bannerIcon}
                    <Text style={s.bannerTitle}>{bannerTitle}</Text>
                </View>
                <View style={s.bannerRight}>
                    <TouchableOpacity style={s.chevronBox} onPress={toggleExpand}>
                        {isExpanded ? <ChevronDown size={20} color={theme.colors.neutral[500]} /> : <ChevronUp size={20} color={theme.colors.neutral[500]} />}
                    </TouchableOpacity>
                    {!isExpanded && (
                        <TouchableOpacity style={s.closeBox} onPress={handleDismiss}>
                            <X size={20} color={theme.colors.neutral[500]} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* ── Main Progress Bar ── */}
            <View style={[s.mainProgressTrack, isExpanded && s.mainProgressHidden]}>
                <Animated.View
                    style={[
                        s.mainProgressFill,
                        {
                            width: animProgressUI,
                            backgroundColor: hasFailed ? theme.colors.error : allDone ? theme.colors.success : theme.colors.primary,
                        },
                    ]}
                />
            </View>

            {/* ── Collapsible Content ── */}
            <Animated.View style={[s.contentBox, { opacity: animFade }]}>
                <View style={s.statsRow}>
                    <StatPill label="Uploaded" value={uploadedCount} />
                    <StatPill label="Queued" value={queuedCount} />
                    <StatPill label="Failed" value={failedCount} color={theme.colors.error} />
                    <StatPill label="Avg speed" value="-- MB/s" />
                </View>

                <View style={s.actionsRow}>
                    <Text style={s.speedTxt}>{formatBytes(uploadedBytes)} / {formatBytes(totalBytes)} ({overallProgress}%)</Text>
                    <TouchableOpacity style={s.clearBtn} onPress={clearCompleted}>
                        <Text style={s.clearBtnTxt}>Clear completed</Text>
                    </TouchableOpacity>
                </View>

                {/* ── Expanded: file list ────────────────────────────────────── */}
                <Animated.View style={{ height: animHeight, overflow: 'hidden' }}>
                    <View style={s.listContainer}>
                        <FlatList
                            data={tasks}
                            keyExtractor={t => t.id}
                            removeClippedSubviews={true}
                            initialNumToRender={10}
                            maxToRenderPerBatch={5}
                            windowSize={5}
                            nestedScrollEnabled={true}
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
        </Animated.View>
    );
}

// ── Stat pill sub-component ──────────────────────────────────────────────────

const StatPill = React.memo(function StatPill({
    label, value, color
}: {
    label: string; value: number | string; color?: string;
}) {
    return (
        <View style={s.statPill}>
            <Text style={s.statLabel}>{label}</Text>
            <Text style={[s.pillVal, color ? { color } : null]}>{value}</Text>
        </View>
    );
});

// ── Styles ───────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 90,
        left: theme.spacing.lg,
        right: theme.spacing.lg,
        backgroundColor: theme.colors.card,
        borderRadius: theme.radius.modal, // Premium edge curves
        overflow: 'hidden',
        ...theme.shadows.elevation2, // SaaS drop-shadow
    },
    bannerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.lg,
        paddingBottom: theme.spacing.md,
    },
    bannerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
    },
    bannerTitle: {
        fontSize: theme.typography.subtitle.fontSize,
        fontWeight: theme.typography.subtitle.fontWeight,
        color: theme.colors.neutral[900],
    },
    bannerRight: {
        flexDirection: 'row',
        gap: theme.spacing.sm,
    },
    chevronBox: {
        padding: theme.spacing.xs,
        backgroundColor: theme.colors.neutral[50],
        borderRadius: theme.radius.sm,
    },
    closeBox: {
        padding: theme.spacing.xs,
        backgroundColor: theme.colors.neutral[50], // Muted close
        borderRadius: theme.radius.sm,
    },
    contentBox: {
        flex: 1,
    },
    // ── Main Header line progress ────────────────────────────────────────────
    mainProgressTrack: {
        height: 3,
        backgroundColor: theme.colors.neutral[100],
        width: '100%',
    },
    mainProgressHidden: {
        opacity: 0,
    },
    mainProgressFill: {
        height: 3,
    },
    // ── Stats row ────────────────────────────────────────────────────────────
    statsRow: {
        flexDirection: 'row',
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        gap: theme.spacing.lg,
        flexWrap: 'wrap',
    },
    statPill: {
        alignItems: 'flex-start',
        gap: 2,
    },
    statLabel: {
        fontSize: 11,
        color: theme.colors.neutral[500],
        fontWeight: '500',
        textTransform: 'uppercase',
    },
    pillVal: {
        fontSize: 15,
        fontWeight: '700',
        color: theme.colors.neutral[900],
    },
    // ── Actions ──────────────────────────────────────────────────────────────
    actionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: theme.spacing.lg,
        paddingBottom: theme.spacing.md,
    },
    speedTxt: {
        fontSize: 13,
        color: theme.colors.neutral[600],
        fontWeight: '500',
    },
    clearBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        padding: 4,
    },
    clearBtnTxt: {
        fontSize: 12,
        fontWeight: '500',
        color: theme.colors.primary,
    },
    // ── List ─────────────────────────────────────────────────────────────────
    listContainer: {
        flex: 1,
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.sm,
        borderTopWidth: 1,
        borderTopColor: theme.colors.neutral[100],
    },
    list: {
        paddingBottom: 20,
    }
});

export default React.memo(UploadProgressOverlay);
