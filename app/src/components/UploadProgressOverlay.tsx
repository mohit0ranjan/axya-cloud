import React, { useMemo, useRef, useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    Animated, Dimensions, FlatList, Alert, Platform,
} from 'react-native';
import {
    ChevronUp, ChevronDown, CheckCircle2, AlertTriangle, X
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUpload } from '../context/UploadContext';
import UploadProgress from './UploadProgress';
import { theme as staticTheme } from '../ui/theme';
import { useTheme } from '../context/ThemeContext';

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
    const navigation = useNavigation<any>();
    const insets = useSafeAreaInsets();
    const { theme } = useTheme();
    const {
        tasks,
        cancelUpload, pauseUpload, resumeUpload, clearCompleted, cancelAll,
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

    const hasFailed = failedCount > 0;
    const isIdle = activeCount === 0;
    const progressColor = hasFailed ? theme.colors.danger : (allDone ? theme.colors.success : theme.colors.primary);

    let bannerTitle = '';
    let bannerIcon = null;

    if (hasFailed) {
        bannerTitle = `${failedCount} upload${failedCount > 1 ? 's' : ''} failed`;
        bannerIcon = <AlertTriangle color={theme.colors.danger} size={18} />;
    } else if (allDone) {
        bannerTitle = 'Uploads complete';
        bannerIcon = <CheckCircle2 color={theme.colors.success} size={18} />;
    } else {
        bannerTitle = `Uploading ${activeCount} item${activeCount > 1 ? 's' : ''} · ${overallProgress}% · ${formatSpeed(avgUploadSpeedBps, isIdle)}`;
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
            duration: staticTheme.motion.duration,
            useNativeDriver: false,
        }).start(() => {
            if (nextValue === 0) setIsExpanded(false);
        });
    };

    const handleDismiss = () => {
        const hasRunningOrQueued = activeCount > 0 || queuedCount > 0;
        if (!hasRunningOrQueued) {
            setIsDismissed(true);
            return;
        }

        const confirmText = 'Cancel all current and queued uploads?';
        if (Platform.OS === 'web') {
            if (window.confirm(confirmText)) cancelAll();
            return;
        }

        Alert.alert(
            'Cancel All Uploads',
            confirmText,
            [
                { text: 'Keep Uploading', style: 'cancel' },
                { text: 'Cancel All', style: 'destructive', onPress: cancelAll },
            ]
        );
    };

    const s = React.useMemo(() => StyleSheet.create({
        container: {
            position: 'absolute',
            bottom: Math.max(insets.bottom, 0) + 70,
            left: staticTheme.spacing.lg,
            right: staticTheme.spacing.lg,
            backgroundColor: theme.colors.card,
            borderRadius: staticTheme.radius.modal,
            overflow: 'hidden',
            ...staticTheme.shadows.elevation2,
        },
        bannerRow: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: staticTheme.spacing.lg,
            paddingTop: staticTheme.spacing.md,
            paddingBottom: staticTheme.spacing.md,
            minHeight: 54,
        },
        bannerLeft: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: staticTheme.spacing.sm,
            flex: 1,
            minWidth: 0,
        },
        bannerTitle: {
            fontSize: staticTheme.typography.subtitle.fontSize,
            fontWeight: staticTheme.typography.subtitle.fontWeight,
            color: theme.colors.textHeading,
        },
        bannerRight: {
            flexDirection: 'row',
            gap: staticTheme.spacing.sm,
        },
        chevronBox: {
            padding: staticTheme.spacing.xs,
            backgroundColor: theme.colors.inputBg,
            borderRadius: staticTheme.radius.sm,
        },
        closeBox: {
            padding: staticTheme.spacing.xs,
            backgroundColor: theme.colors.inputBg,
            borderRadius: staticTheme.radius.sm,
        },
        mainProgressTrack: {
            height: 3,
            backgroundColor: theme.colors.border,
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
            paddingVertical: staticTheme.spacing.md,
            paddingHorizontal: staticTheme.spacing.lg,
            gap: staticTheme.spacing.lg,
            flexWrap: 'wrap',
        },
        statPill: {
            alignItems: 'flex-start',
            gap: 2,
        },
        statLabel: {
            fontSize: 11,
            color: theme.colors.textBody,
            fontWeight: '500',
            textTransform: 'uppercase',
        },
        pillVal: {
            fontSize: 15,
            fontWeight: '600',
            color: theme.colors.textHeading,
        },
        actionsRow: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: staticTheme.spacing.lg,
            paddingBottom: staticTheme.spacing.md,
        },
        speedTxt: {
            fontSize: 13,
            color: theme.colors.muted,
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
        managerBtn: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            padding: 4,
        },
        managerBtnTxt: {
            fontSize: 12,
            fontWeight: '700',
            color: theme.colors.primary,
        },
        listContainer: {
            flex: 1,
            paddingHorizontal: staticTheme.spacing.lg,
            paddingTop: staticTheme.spacing.sm,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
        },
        list: {
            paddingBottom: 20,
        },
        emptyUpdates: {
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
            paddingHorizontal: staticTheme.spacing.lg,
            paddingTop: staticTheme.spacing.md,
        },
        emptyUpdatesTxt: {
            fontSize: 13,
            color: theme.colors.textBody,
            fontWeight: '500',
        },
    }), [theme, insets.bottom]);

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

    if (tasks.length === 0 || isDismissed) return null;

    return (
        <View style={s.container}>
            <View style={s.bannerRow}>
                <View style={s.bannerLeft}>
                    {bannerIcon}
                    <Text style={s.bannerTitle} numberOfLines={1}>{bannerTitle}</Text>
                </View>
                <View style={s.bannerRight}>
                    <TouchableOpacity style={s.chevronBox} onPress={toggleExpand}>
                        {isExpanded ? <ChevronDown size={20} color={theme.colors.muted} /> : <ChevronUp size={20} color={theme.colors.muted} />}
                    </TouchableOpacity>
                    {!isExpanded && (
                        <TouchableOpacity style={s.closeBox} onPress={handleDismiss}>
                            <X size={20} color={theme.colors.muted} />
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
                        <StatPill label="Failed" value={failedCount} color={theme.colors.danger} />
                        <StatPill label="Avg speed" value={formatSpeed(avgUploadSpeedBps, isIdle)} />
                    </View>

                    <View style={s.actionsRow}>
                        <Text style={s.speedTxt}>{formatBytes(uploadedBytes)} / {formatBytes(totalBytes)} ({overallProgress}%)</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                            <TouchableOpacity
                                style={s.managerBtn}
                                onPress={() => navigation.navigate('UploadManager')}
                            >
                                <Text style={s.managerBtnTxt}>Open Manager</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.clearBtn} onPress={clearCompleted}>
                                <Text style={s.clearBtnTxt}>Clear completed</Text>
                            </TouchableOpacity>
                        </View>
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

export default React.memo(UploadProgressOverlay);
