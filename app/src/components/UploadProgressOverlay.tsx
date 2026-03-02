import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    Animated, Dimensions, FlatList, Platform,
} from 'react-native';
import {
    ChevronUp, ChevronDown, X, CheckCircle2,
    AlertCircle, Loader2, Pause, Play, Trash2
} from 'lucide-react-native';
import { useUploadStore, UploadTask } from '../context/UploadStore';
import * as Progress from 'react-native-progress'; // Assuming this might be available or I'll use simple View

const { width, height } = Dimensions.get('window');

const C = {
    primary: '#4B6EF5',
    text: '#1A1F36',
    muted: '#8892A4',
    bg: '#FFFFFF',
    border: '#EAEDF3',
    success: '#1FD45A',
    danger: '#FF4E4E',
};

export default function UploadProgressOverlay() {
    const { tasks, isUploading, cancelTask, clearCompleted, retryTask } = useUploadStore();
    const [expanded, setExpanded] = useState(false);
    const [animation] = useState(new Animated.Value(0));

    // Only show if there are tasks that are not yet cleared
    const activeTasks = tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled' && t.status !== 'failed');
    const failedTasks = tasks.filter(t => t.status === 'failed');
    const completedTasks = tasks.filter(t => t.status === 'completed');

    const totalTasks = tasks.length;
    if (totalTasks === 0) return null;

    const toggleExpand = () => {
        const toValue = expanded ? 0 : 1;
        Animated.spring(animation, {
            toValue,
            useNativeDriver: false,
            friction: 8,
        }).start();
        setExpanded(!expanded);
    };

    const overlayHeight = animation.interpolate({
        inputRange: [0, 1],
        outputRange: [70, height * 0.6],
    });

    const currentUploading = tasks.find(t => t.status === 'uploading');
    const overallProgress = tasks.length > 0
        ? tasks.reduce((acc, t) => acc + (t.status === 'completed' ? 100 : t.progress), 0) / tasks.length
        : 0;

    const renderTask = ({ item }: { item: UploadTask }) => (
        <View style={s.taskRow}>
            <View style={s.taskIcon}>
                {item.status === 'uploading' && <Loader2 color={C.primary} size={20} />}
                {item.status === 'queued' && <Loader2 color={C.muted} size={20} opacity={0.5} />}
                {item.status === 'completed' && <CheckCircle2 color={C.success} size={20} />}
                {item.status === 'failed' && <AlertCircle color={C.danger} size={20} />}
                {item.status === 'cancelled' && <X color={C.muted} size={20} />}
            </View>
            <View style={s.taskInfo}>
                <Text style={s.taskName} numberOfLines={1}>{item.file.name}</Text>
                <Text style={s.taskStatus}>
                    {item.status === 'uploading' ? `Uploading... ${Math.round(item.progress)}%` :
                        item.status === 'queued' ? 'Queued' :
                            item.status === 'failed' ? `Failed: ${item.error}` :
                                item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                </Text>
                {item.status === 'uploading' && (
                    <View style={s.miniProgressTrack}>
                        <View style={[s.miniProgressFill, { width: `${item.progress}%` }]} />
                    </View>
                )}
            </View>
            <View style={s.taskActions}>
                {item.status === 'uploading' && (
                    <TouchableOpacity onPress={() => cancelTask(item.id)}>
                        <X color={C.muted} size={18} />
                    </TouchableOpacity>
                )}
                {item.status === 'failed' && (
                    <TouchableOpacity onPress={() => retryTask(item.id)}>
                        <Play color={C.primary} size={18} />
                    </TouchableOpacity>
                )}
                {(item.status === 'completed' || item.status === 'cancelled') && (
                    <CheckCircle2 color={C.success} size={18} opacity={item.status === 'completed' ? 1 : 0} />
                )}
            </View>
        </View>
    );

    return (
        <Animated.View style={[s.container, { height: overlayHeight }]}>
            {/* Header / Summary Bar */}
            <TouchableOpacity
                activeOpacity={0.9}
                onPress={toggleExpand}
                style={s.header}
            >
                <View style={s.headerInfo}>
                    <Text style={s.headerTitle}>
                        {activeTasks.length > 0 ? `Uploading ${activeTasks.length} file(s)...` :
                            failedTasks.length > 0 ? `${failedTasks.length} upload(s) failed` :
                                'Uploads complete'}
                    </Text>
                    <Text style={s.headerSub}>
                        {Math.round(overallProgress)}% overall
                    </Text>
                </View>

                <View style={s.headerActions}>
                    {expanded ? <ChevronDown color={C.text} size={24} /> : <ChevronUp color={C.text} size={24} />}
                    {!expanded && (
                        <TouchableOpacity style={s.closeBtn} onPress={clearCompleted}>
                            <X color={C.text} size={20} />
                        </TouchableOpacity>
                    )}
                </View>
            </TouchableOpacity>

            {/* Progress Bar (Always visible on top of header) */}
            <View style={s.mainProgressTrack}>
                <View style={[s.mainProgressFill, { width: `${overallProgress}%` }]} />
            </View>

            {/* Expanded List */}
            {expanded && (
                <View style={s.listContainer}>
                    <View style={s.listHeader}>
                        <Text style={s.listTitle}>Upload Queue</Text>
                        <TouchableOpacity onPress={clearCompleted}>
                            <Text style={s.clearText}>Clear Finished</Text>
                        </TouchableOpacity>
                    </View>
                    <FlatList
                        data={tasks}
                        keyExtractor={t => t.id}
                        renderItem={renderTask}
                        contentContainerStyle={s.list}
                        showsVerticalScrollIndicator={false}
                    />
                </View>
            )}
        </Animated.View>
    );
}

const s = StyleSheet.create({
    container: {
        position: 'absolute',
        bottom: 90, // Above bottom nav
        left: 15,
        right: 15,
        backgroundColor: C.bg,
        borderRadius: 20,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 10,
        zIndex: 1000,
    },
    header: {
        height: 70,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        justifyContent: 'space-between',
    },
    headerInfo: {
        flex: 1,
    },
    headerTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: C.text,
    },
    headerSub: {
        fontSize: 12,
        color: C.muted,
        marginTop: 2,
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    closeBtn: {
        padding: 4,
    },
    mainProgressTrack: {
        height: 3,
        backgroundColor: C.border,
        width: '100%',
    },
    mainProgressFill: {
        height: 3,
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
        marginBottom: 16,
    },
    listTitle: {
        fontSize: 16,
        fontWeight: '800',
        color: C.text,
    },
    clearText: {
        fontSize: 13,
        fontWeight: '600',
        color: C.primary,
    },
    list: {
        paddingBottom: 20,
    },
    taskRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: C.border,
    },
    taskIcon: {
        width: 36,
        height: 36,
        justifyContent: 'center',
        alignItems: 'center',
    },
    taskInfo: {
        flex: 1,
        marginLeft: 12,
    },
    taskName: {
        fontSize: 14,
        fontWeight: '600',
        color: C.text,
    },
    taskStatus: {
        fontSize: 11,
        color: C.muted,
        marginTop: 2,
    },
    miniProgressTrack: {
        height: 2,
        backgroundColor: C.border,
        borderRadius: 1,
        marginTop: 6,
        width: '90%',
    },
    miniProgressFill: {
        height: 2,
        backgroundColor: C.primary,
        borderRadius: 1,
    },
    taskActions: {
        paddingLeft: 12,
    },
});
