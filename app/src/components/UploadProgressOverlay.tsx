import React, { useMemo, useRef, useState, useEffect } from 'react';
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
    if (bytes <= 0) return '0 B';
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`;
}

function formatSpeed(bytesPerSecond: number, isIdle: boolean): string {
    if (isIdle) return '0 B/s';
    if (!bytesPerSecond || bytesPerSecond <= 0) return '--';
    return `${formatBytes(bytesPerSecond)}/s`;
}

function UploadProgressOverlay() {
    const {
        tasks,
        cancelUpload, pauseUpload, resumeUpload, clearCompleted,
        totalFiles, uploadedCount, queuedCount, failedCount,
        activeCount, overallProgress, totalBytes, uploadedBytes,
        avgUploadSpeedBps,
    } = useUpload();

    const [isExpanded, setIsExpanded] = useState(false);
    const [isDismissed, setIsDismissed] = useState(false);
    const animExpand = useRef(new Animated.Value(0)).current;

    const visibleTasks = useMemo(
        () => tasks.filter(t => t.status !== 'cancelled'),
        [tasks]
    );

    const prevTotal = useRef(totalFiles);
    useEffect(() => {
        if (totalFiles > prevTotal.current) {
            setIsDismissed(false);
        }
        prevTotal.current = totalFiles;
    }, [totalFiles]);

    const allDone = totalFiles > 0 && activeCount === 0 && queuedCount === 0;
    const isPerfectSuccess = allDone && failedCount === 0;

    useEffect(() => {
        if (isPerfectSuccess) {
            const timer = setTimeout(() => setIsDismissed(true), 3000);
            return () => clearTimeout(timer);
        }
    }, [isPerfectSuccess]);

    if (tasks.length === 0 || isDismissed) return null;

    const hasFailed = failedCount > 0;
    const isIdle = activeCount === 0;
    const progressColor = hasFailed ? theme.colors.error : (allDone ? theme.colors.success : theme.colors.primary);

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

    const expandedHeight = Math.min(
        (visibleTasks.length > 0 ? 170 + (visibleTasks.length * 105) : 170),
        height * 0.56
    );

    const animatedContentHeight = animExpand.interpolate({
        inputRange: [0, 1],
        outputRange: [0, expandedHeight],
    });

    const animatedContentOpacity = animExpand.interpolate({
        inputRange: [0, 0.2, 1],
        outputRange: [0, 0.15, 1],
    });

    const toggleExpand = () => {
        const nextValue = isExpanded ? 0 : 1;
        if (!isExpanded) setIsExpanded(true);
        Animated.timing(animExpand, {
            toValue: nextValue,
            duration: theme.motion.duration,
            useNativeDriver: false,
        }).start(() => {
            if (nextValue === 0) setIsExpanded(false);
        });
    };

    const handleDismiss = () => {
        setIsDismissed(true);
    };

    return (
        <View style={s.container}>
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

            <View style={s.mainProgressTrack}>
                <View
                    style={[
                        s.mainProgressFill,
                        { width: `${overallProgress}%`, backgroundColor: progressColor },
                    ]}
                />
            </View>

            <Animated.View
                style={[
                    s.contentWrap,
                    { height: animatedContentHeight, opacity: animatedContentOpacity },
                ]}
            >
                <View style={s.contentInner}>
                    <View style={s.statsRow}>
                        <StatPill label="Uploaded" value={uploadedCount} />
                        <StatPill label="Queued" value={queuedCount} />
                        <StatPill label="Failed" value={failedCount} color={theme.colors.error} />
                        <StatPill label="Avg speed" value={formatSpeed(avgUploadSpeedBps, isIdle)} />
                    </View>

                    <View style={s.actionsRow}>
                        <Text style={s.speedTxt}>{formatBytes(uploadedBytes)} / {formatBytes(totalBytes)} ({overallProgress}%)</Text>
                        <TouchableOpacity style={s.clearBtn} onPress={clearCompleted}>
                            <Text style={s.clearBtnTxt}>Clear completed</Text>
                        </TouchableOpacity>
                    </View>

                    {visibleTasks.length > 0 ? (
                        <View style={s.listContainer}>
                            <FlatList
                                data={visibleTasks}
                                keyExtractor={t => t.id}
                                removeClippedSubviews
                                initialNumToRender={8}
                                maxToRenderPerBatch={5}
                                windowSize={4}
                                nestedScrollEnabled
                                renderItem={({ item }) => (
                                    <UploadProgress
                                        task={item}
                                        onCancel={cancelUpload}
                                        onPause={pauseUpload}
                                        onResume={resumeUpload}
                                        onRetry={resumeUpload}
                                    />
                                )}
                                contentContainerStyle={s.list}
                                showsVerticalScrollIndicator={false}
                            />
                        </View>
                    ) : (
                        <View style={s.emptyUpdates}>
                            <Text style={s.emptyUpdatesTxt}>No upload updates available.</Text>
                        </View>
                    )}
                </View>
            </Animated.View>
        </View>
    );
}

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

const s = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 90,
        left: theme.spacing.lg,
        right: theme.spacing.lg,
        backgroundColor: theme.colors.card,
        borderRadius: theme.radius.modal,
        overflow: 'hidden',
        ...theme.shadows.elevation2,
    },
    bannerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.md,
        paddingBottom: theme.spacing.md,
        minHeight: 54,
    },
    bannerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        flex: 1,
        minWidth: 0,
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
        backgroundColor: theme.colors.neutral[50],
        borderRadius: theme.radius.sm,
    },
    mainProgressTrack: {
        height: 3,
        backgroundColor: theme.colors.neutral[100],
        width: '100%',
    },
    mainProgressFill: {
        height: 3,
    },
    contentWrap: {
        overflow: 'hidden',
    },
    contentInner: {
        flex: 1,
    },
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
    listContainer: {
        flex: 1,
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.sm,
        borderTopWidth: 1,
        borderTopColor: theme.colors.neutral[100],
    },
    list: {
        paddingBottom: 20,
    },
    emptyUpdates: {
        borderTopWidth: 1,
        borderTopColor: theme.colors.neutral[100],
        paddingHorizontal: theme.spacing.lg,
        paddingTop: theme.spacing.md,
    },
    emptyUpdatesTxt: {
        fontSize: 13,
        color: theme.colors.neutral[500],
        fontWeight: '500',
    },
});

export default React.memo(UploadProgressOverlay);
