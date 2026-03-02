/**
 * UploadProgressOverlay.tsx
 *
 * Persistent floating panel showing all upload activity.
 * ✅ Reads overallProgress directly from context (no local re-computation)
 * ✅ Passes onRetry to each UploadProgress card
 * ✅ "Retry all failed" button
 * ✅ Smooth animated expand/collapse
 */

import React, { useState, useCallback } from 'react';
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
    border: '#EAEDF3',
    success: '#1FD45A',
    danger: '#EF4444',
};

export default function UploadProgressOverlay() {
    const {
        tasks,
        cancelUpload,
        pauseUpload,
        resumeUpload,
        clearCompleted,
        retryFailed,
        activeCount,
        overallProgress,
    } = useUpload();

    const [expanded, setExpanded] = useState(false);
    const [animation] = useState(new Animated.Value(0));

    // Don't render if nothing to show
    if (tasks.length === 0) return null;

    const toggleExpand = () => {
        const toValue = expanded ? 0 : 1;
        Animated.spring(animation, {
            toValue,
            useNativeDriver: false,
            friction: 8,
            tension: 40,
        }).start();
        setExpanded(prev => !prev);
    };

    const overlayHeight = animation.interpolate({
        inputRange: [0, 1],
        outputRange: [70, height * 0.65],
    });

    const allDone = tasks.every(t => t.status === 'completed' || t.status === 'cancelled');
    const hasFailed = tasks.some(t => t.status === 'failed');

    const headerTitle = activeCount > 0
        ? `Uploading ${activeCount} file${activeCount > 1 ? 's' : ''}…`
        : allDone
            ? 'All uploads complete ✅'
            : hasFailed
                ? 'Some uploads failed ⚠️'
                : 'Upload queue';

    // Stable handlers via useCallback to prevent child re-renders
    const handleRetry = useCallback((id: string) => resumeUpload(id), [resumeUpload]);

    return (
        <Animated.View style={[s.container, { height: overlayHeight }]}>
            {/* ── Header ──────────────────────────────────────────────────── */}
            <TouchableOpacity
                activeOpacity={0.9}
                onPress={toggleExpand}
                style={s.header}
            >
                <View style={s.headerInfo}>
                    <Text style={s.headerTitle} numberOfLines={1}>
                        {headerTitle}
                    </Text>
                    <Text style={s.headerSub}>
                        {overallProgress}% overall · {tasks.length} total
                    </Text>
                </View>

                <View style={s.headerActions}>
                    {hasFailed && (
                        <TouchableOpacity
                            onPress={retryFailed}
                            style={s.actionBtn}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            accessibilityLabel="Retry all failed uploads"
                        >
                            <RotateCcw size={18} color={C.primary} />
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={toggleExpand} style={s.expandBtn}>
                        {expanded
                            ? <ChevronDown color={C.text} size={22} />
                            : <ChevronUp color={C.text} size={22} />}
                    </TouchableOpacity>
                </View>
            </TouchableOpacity>

            {/* ── Overall progress strip ────────────────────────────────── */}
            <View style={s.mainProgressTrack}>
                <Animated.View
                    style={[
                        s.mainProgressFill,
                        {
                            width: `${overallProgress}%`,
                            backgroundColor: hasFailed ? C.danger : allDone ? C.success : C.primary,
                        },
                    ]}
                />
            </View>

            {/* ── Task list (visible when expanded) ────────────────────── */}
            {expanded && (
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
                        // Important: tasks are new object references on every update,
                        // so FlatList propagates updates correctly
                        extraData={tasks}
                    />
                </View>
            )}
        </Animated.View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
        backgroundColor: C.primary,
    },
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
});
