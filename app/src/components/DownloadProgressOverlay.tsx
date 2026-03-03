/**
 * DownloadProgressOverlay.tsx
 *
 * Persistent floating panel showing all download activity.
 * ✅ Shows individual download progress
 * ✅ "Cancel All" button with confirmation modal
 * ✅ Auto-hides when no downloads are active
 * ✅ Smooth animated expand/collapse
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    Animated, Dimensions, FlatList, Modal,
} from 'react-native';
import { ChevronUp, ChevronDown, XCircle, Download, X, Check } from 'lucide-react-native';
import { useDownload } from '../context/DownloadContext';
import { theme } from '../ui/theme';

const { height } = Dimensions.get('window');

// ── Single download row ──────────────────────────────────────────────────────

function DownloadRow({ task, onCancel }: { task: any; onCancel: (id: string) => void }) {
    const isActive = task.status === 'downloading' || task.status === 'queued';
    const isFailed = task.status === 'failed';
    const isDone = task.status === 'completed';
    const isCancelled = task.status === 'cancelled';

    const statusColor = isDone
        ? theme.colors.success
        : isFailed
            ? theme.colors.danger
            : isCancelled
                ? '#8892A4'
                : theme.colors.primary;

    const statusLabel = isDone
        ? 'Done'
        : isFailed
            ? task.error || 'Failed'
            : isCancelled
                ? 'Cancelled'
                : task.status === 'queued'
                    ? 'Queued'
                    : `${task.progress}%`;

    return (
        <View style={s.row}>
            <View style={[s.rowIcon, { backgroundColor: `${statusColor}18` }]}>
                <Download color={statusColor} size={16} />
            </View>
            <View style={s.rowInfo}>
                <Text style={s.rowName} numberOfLines={1}>{task.fileName}</Text>
                <View style={s.rowBottom}>
                    <View style={s.progressTrack}>
                        <View style={[
                            s.progressFill,
                            {
                                width: `${Math.max(task.progress, isDone ? 100 : 0)}%`,
                                backgroundColor: statusColor,
                            },
                        ]} />
                    </View>
                    <Text style={[s.rowStatus, { color: statusColor }]}>{statusLabel}</Text>
                </View>
            </View>
            {isActive && (
                <TouchableOpacity
                    style={s.rowCancelBtn}
                    onPress={() => onCancel(task.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <X color="#8892A4" size={16} />
                </TouchableOpacity>
            )}
        </View>
    );
}

// ── Main Overlay ─────────────────────────────────────────────────────────────

export default function DownloadProgressOverlay() {
    const {
        tasks, cancelDownload, cancelAll, clearCompleted,
        activeCount, overallProgress, hasActive,
    } = useDownload();

    const [expanded, setExpanded] = useState(false);
    const [cancelModalVisible, setCancelModalVisible] = useState(false);
    const expandAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(100)).current;
    const [visible, setVisible] = useState(false);

    // Show/hide the entire overlay based on whether there are tasks
    const shouldShow = tasks.length > 0;

    useEffect(() => {
        if (shouldShow && !visible) {
            setVisible(true);
            Animated.spring(slideAnim, {
                toValue: 0,
                tension: 60,
                friction: 10,
                useNativeDriver: true,
            }).start();
        } else if (!shouldShow && visible) {
            Animated.timing(slideAnim, {
                toValue: 100,
                duration: 250,
                useNativeDriver: true,
            }).start(() => {
                setVisible(false);
                setExpanded(false);
            });
        }
    }, [shouldShow]);

    // Auto-collapse when all downloads finish
    useEffect(() => {
        if (!hasActive && expanded) {
            toggleExpand();
        }
    }, [hasActive]);

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

    const handleCancelAll = useCallback(() => {
        setCancelModalVisible(true);
    }, []);

    const confirmCancelAll = useCallback(() => {
        cancelAll();
        setCancelModalVisible(false);
    }, [cancelAll]);

    const handleClearAndDismiss = useCallback(() => {
        clearCompleted();
    }, [clearCompleted]);

    if (!visible) return null;

    const allDone = tasks.length > 0 && !hasActive;
    const hasFailed = tasks.some(t => t.status === 'failed');
    const headerTitle = hasActive
        ? `Downloading ${activeCount} file${activeCount > 1 ? 's' : ''}…`
        : allDone
            ? hasFailed
                ? 'Some downloads failed ⚠️'
                : 'Downloads complete ✅'
            : 'Downloads';

    const expandedHeight = expandAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, Math.min(tasks.length * 68 + 60, height * 0.4)],
    });

    return (
        <>
            <Animated.View style={[
                s.container,
                { transform: [{ translateY: slideAnim }] },
            ]}>
                {/* Header bar */}
                <TouchableOpacity
                    style={s.header}
                    onPress={toggleExpand}
                    activeOpacity={0.85}
                >
                    <View style={s.headerLeft}>
                        <View style={[s.headerDot, {
                            backgroundColor: hasActive
                                ? theme.colors.primary
                                : hasFailed
                                    ? theme.colors.danger
                                    : theme.colors.success,
                        }]} />
                        <Text style={s.headerTitle}>{headerTitle}</Text>
                    </View>
                    <View style={s.headerRight}>
                        {hasActive && (
                            <Text style={s.headerPct}>{overallProgress}%</Text>
                        )}
                        {expanded
                            ? <ChevronDown color="#8892A4" size={20} />
                            : <ChevronUp color="#8892A4" size={20} />
                        }
                    </View>
                </TouchableOpacity>

                {/* Main progress bar (always visible) */}
                {hasActive && (
                    <View style={s.mainProgressTrack}>
                        <View style={[s.mainProgressFill, { width: `${overallProgress}%` }]} />
                    </View>
                )}

                {/* Expanded area */}
                <Animated.View style={[s.expandArea, { height: expandedHeight }]}>
                    <FlatList
                        data={tasks}
                        keyExtractor={item => item.id}
                        renderItem={({ item }) => (
                            <DownloadRow task={item} onCancel={cancelDownload} />
                        )}
                        showsVerticalScrollIndicator={false}
                        style={s.list}
                    />
                    {/* Action buttons */}
                    <View style={s.actions}>
                        {hasActive && (
                            <TouchableOpacity
                                style={s.cancelAllBtn}
                                onPress={handleCancelAll}
                                activeOpacity={0.85}
                            >
                                <XCircle color="#fff" size={16} />
                                <Text style={s.cancelAllText}>Cancel All</Text>
                            </TouchableOpacity>
                        )}
                        {allDone && (
                            <TouchableOpacity
                                style={s.dismissBtn}
                                onPress={handleClearAndDismiss}
                                activeOpacity={0.85}
                            >
                                <Text style={s.dismissText}>Dismiss</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                </Animated.View>
            </Animated.View>

            {/* ── Cancel All Confirmation Modal ─────────────────────────────── */}
            <Modal
                visible={cancelModalVisible}
                transparent
                animationType="fade"
                onRequestClose={() => setCancelModalVisible(false)}
            >
                <View style={s.modalOverlay}>
                    <View style={s.modalCard}>
                        <View style={s.modalIconCircle}>
                            <XCircle color={theme.colors.danger} size={32} />
                        </View>
                        <Text style={s.modalTitle}>Cancel All Downloads?</Text>
                        <Text style={s.modalBody}>
                            {activeCount} active download{activeCount > 1 ? 's' : ''} will be cancelled.
                            This cannot be undone.
                        </Text>
                        <View style={s.modalActions}>
                            <TouchableOpacity
                                style={s.modalSecondaryBtn}
                                onPress={() => setCancelModalVisible(false)}
                            >
                                <Text style={s.modalSecondaryText}>Keep Downloading</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={s.modalDangerBtn}
                                onPress={confirmCancelAll}
                            >
                                <XCircle color="#fff" size={16} />
                                <Text style={s.modalDangerText}>Cancel All</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#fff',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 16,
        elevation: 20,
        zIndex: 999,
    },

    // Header
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
    },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
    headerDot: { width: 10, height: 10, borderRadius: 5 },
    headerTitle: { fontSize: 15, fontWeight: '700', color: theme.colors.textHeading },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    headerPct: { fontSize: 14, fontWeight: '700', color: theme.colors.primary },

    // Main progress
    mainProgressTrack: {
        height: 3,
        backgroundColor: '#EDF1F7',
        marginHorizontal: 20,
    },
    mainProgressFill: {
        height: 3,
        backgroundColor: theme.colors.primary,
        borderRadius: 2,
    },

    // Expand area
    expandArea: { overflow: 'hidden' },
    list: { flex: 1, paddingHorizontal: 16 },

    // Row
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 10,
        paddingHorizontal: 4,
        gap: 12,
    },
    rowIcon: {
        width: 36,
        height: 36,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
    },
    rowInfo: { flex: 1, gap: 5 },
    rowName: { fontSize: 13, fontWeight: '600', color: theme.colors.textHeading },
    rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    progressTrack: {
        flex: 1,
        height: 4,
        backgroundColor: '#EDF1F7',
        borderRadius: 2,
        overflow: 'hidden',
    },
    progressFill: { height: 4, borderRadius: 2 },
    rowStatus: { fontSize: 11, fontWeight: '600', minWidth: 40, textAlign: 'right' },
    rowCancelBtn: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
        alignItems: 'center',
    },

    // Actions
    actions: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    cancelAllBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        backgroundColor: theme.colors.danger,
        paddingHorizontal: 18,
        paddingVertical: 10,
        borderRadius: 12,
    },
    cancelAllText: { color: '#fff', fontSize: 13, fontWeight: '700' },
    dismissBtn: {
        paddingHorizontal: 18,
        paddingVertical: 10,
        backgroundColor: '#F1F5F9',
        borderRadius: 12,
    },
    dismissText: { color: theme.colors.textHeading, fontSize: 13, fontWeight: '600' },

    // ── Cancel Confirmation Modal ─────────────────────────────────────────
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    modalCard: {
        width: '100%',
        backgroundColor: '#fff',
        borderRadius: 24,
        padding: 28,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 24,
        elevation: 16,
    },
    modalIconCircle: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: '#FEF2F2',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: '800',
        color: theme.colors.textHeading,
        marginBottom: 8,
        textAlign: 'center',
    },
    modalBody: {
        fontSize: 14,
        color: theme.colors.textBody,
        textAlign: 'center',
        lineHeight: 21,
        marginBottom: 24,
    },
    modalActions: {
        flexDirection: 'row',
        gap: 12,
        width: '100%',
    },
    modalSecondaryBtn: {
        flex: 1,
        height: 48,
        backgroundColor: '#F1F5F9',
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalSecondaryText: {
        color: theme.colors.textHeading,
        fontSize: 14,
        fontWeight: '600',
    },
    modalDangerBtn: {
        flex: 1,
        height: 48,
        backgroundColor: theme.colors.danger,
        borderRadius: 14,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 6,
        shadowColor: theme.colors.danger,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 10,
        elevation: 6,
    },
    modalDangerText: {
        color: '#fff',
        fontSize: 14,
        fontWeight: '700',
    },
});
