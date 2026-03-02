import React, { useState } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    Animated, Dimensions, FlatList,
} from 'react-native';
import { ChevronUp, ChevronDown, X } from 'lucide-react-native';
import { useUpload } from '../context/UploadContext';
import UploadProgress from './UploadProgress';

const { height } = Dimensions.get('window');

const C = {
    primary: '#4B6EF5',
    text: '#1A1F36',
    muted: '#8892A4',
    bg: '#FFFFFF',
    border: '#EAEDF3',
};

export default function UploadProgressOverlay() {
    const { tasks, cancelUpload, pauseUpload, resumeUpload, clearCompleted } = useUpload();
    const [expanded, setExpanded] = useState(false);
    const [animation] = useState(new Animated.Value(0));

    if (tasks.length === 0) return null;

    const toggleExpand = () => {
        const toValue = expanded ? 0 : 1;
        Animated.spring(animation, {
            toValue,
            useNativeDriver: false,
            friction: 8,
            tension: 40,
        }).start();
        setExpanded(!expanded);
    };

    const overlayHeight = animation.interpolate({
        inputRange: [0, 1],
        outputRange: [74, height * 0.6],
    });

    const activeTasksCount = tasks.filter(t => t.status === 'uploading' || t.status === 'queued').length;
    const overallProgress = tasks.length > 0
        ? Math.round(tasks.reduce((acc, t) => acc + t.progress, 0) / tasks.length)
        : 0;

    return (
        <Animated.View style={[s.container, { height: overlayHeight }]}>
            <View style={s.header}>
                <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={toggleExpand}
                    style={s.headerInfo}
                >
                    <Text style={s.headerTitle}>
                        {activeTasksCount > 0 ? `Uploading ${activeTasksCount} file(s)...` : 'Uploads complete'}
                    </Text>
                    <Text style={s.headerSub}>
                        {overallProgress}% overall · {tasks.length} total
                    </Text>
                </TouchableOpacity>

                <View style={s.headerActions}>
                    <TouchableOpacity onPress={toggleExpand} style={s.expandBtn}>
                        {expanded ? <ChevronDown color={C.text} size={24} /> : <ChevronUp color={C.text} size={24} />}
                    </TouchableOpacity>
                </View>
            </View>

            <View style={s.mainProgressTrack}>
                <View style={[s.mainProgressFill, { width: `${overallProgress}%` }]} />
            </View>

            {expanded && (
                <View style={s.listContainer}>
                    <View style={s.listHeader}>
                        <Text style={s.listTitle}>Upload Queue</Text>
                        <TouchableOpacity onPress={clearCompleted}>
                            <Text style={s.clearBtn}>Clear Completed</Text>
                        </TouchableOpacity>
                    </View>
                    <FlatList
                        data={tasks}
                        keyExtractor={t => t.id}
                        renderItem={({ item }) => (
                            <UploadProgress task={item} onCancel={cancelUpload} onPause={pauseUpload} onResume={resumeUpload} />
                        )}
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
        bottom: 90,
        left: 15,
        right: 15,
        backgroundColor: C.bg,
        borderRadius: 24,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 10,
        zIndex: 1000,
        borderWidth: 1,
        borderColor: C.border,
    },
    header: {
        height: 70,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        justifyContent: 'space-between',
    },
    headerInfo: {
        flex: 1,
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
        marginBottom: 16,
        paddingHorizontal: 4,
    },
    listTitle: {
        fontSize: 17,
        fontWeight: '800',
        color: C.text,
    },
    clearBtn: {
        fontSize: 13,
        fontWeight: '600',
        color: C.primary,
    },
    list: {
        paddingBottom: 20,
    },
});
