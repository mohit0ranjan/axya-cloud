/**
 * StarredScreen.tsx — Starred files with sort, FlatList, and debounced markAccessed
 * Fixes #19: was a basic ScrollView with no sorting
 */
import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView, FlatList, TouchableOpacity,
    RefreshControl, Alert, Modal, ScrollView,
} from 'react-native';
import { ArrowLeft, Star, SortAsc, SortDesc, Filter } from 'lucide-react-native';
import apiClient from '../services/apiClient';
import { useToast } from '../context/ToastContext';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import FileCard from '../components/FileCard';
import { FileCardSkeleton } from '../ui/Skeleton';

const SORT_OPTIONS = [
    { key: 'created_at_DESC', label: 'Newest First', icon: SortDesc },
    { key: 'created_at_ASC', label: 'Oldest First', icon: SortAsc },
    { key: 'file_name_ASC', label: 'Name A→Z', icon: SortAsc },
    { key: 'file_name_DESC', label: 'Name Z→A', icon: SortDesc },
    { key: 'file_size_DESC', label: 'Largest First', icon: SortDesc },
    { key: 'file_size_ASC', label: 'Smallest First', icon: SortAsc },
];

function clientSort(files: any[], sortKey: string) {
    return [...files].sort((a, b) => {
        if (sortKey.startsWith('file_name')) {
            const cmp = (a.file_name || '').localeCompare(b.file_name || '');
            return sortKey.endsWith('ASC') ? cmp : -cmp;
        }
        if (sortKey.startsWith('file_size')) {
            const cmp = (a.file_size || 0) - (b.file_size || 0);
            return sortKey.endsWith('ASC') ? cmp : -cmp;
        }
        // default: created_at
        const cmp = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
        return sortKey.endsWith('ASC') ? cmp : -cmp;
    });
}

export default function StarredScreen({ navigation }: any) {
    const { showToast } = useToast();
    const { token } = useContext(AuthContext);
    const { theme } = useTheme();
    const C = theme.colors;

    const [isLoading, setIsLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [files, setFiles] = useState<any[]>([]);
    const [sortKey, setSortKey] = useState('created_at_DESC');
    const [showSortModal, setShowSortModal] = useState(false);

    // ✅ Fix #29: debounce markAccessed  (max once per 5 min per file)
    const lastAccessedRef = useRef<Map<string, number>>(new Map());

    useEffect(() => { fetchStarred(); }, []);

    const fetchStarred = async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get('/files/starred');
            if (res.data.success) setFiles(res.data.files);
        } catch { showToast('Could not load starred files', 'error'); }
        finally { setIsLoading(false); setRefreshing(false); }
    };

    const sortedFiles = clientSort(files, sortKey);
    const currentSort = SORT_OPTIONS.find(s => s.key === sortKey) ?? SORT_OPTIONS[0];

    const handleStar = async (id: string) => {
        try {
            await apiClient.patch(`/files/${id}/star`);
            setFiles(prev => prev.filter(f => f.id !== id));
            showToast('Removed from starred');
        } catch { showToast('Failed to update star', 'error'); }
    };

    const handleTrash = (id: string, name: string) => {
        Alert.alert('Move to Trash', `Move "${name}" to trash?`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Move to Trash', style: 'destructive', onPress: async () => {
                    try {
                        await apiClient.patch(`/files/${id}/trash`);
                        showToast('Moved to trash');
                        setFiles(prev => prev.filter(f => f.id !== id));
                    } catch { showToast('Failed', 'error'); }
                }
            }
        ]);
    };

    const handleOpen = useCallback((item: any, index: number) => {
        const now = Date.now();
        const last = lastAccessedRef.current.get(item.id) ?? 0;
        if (now - last > 5 * 60 * 1000) {
            lastAccessedRef.current.set(item.id, now);
            apiClient.post(`/files/${item.id}/accessed`).catch(() => { });
        }
        navigation.navigate('FilePreview', { files: sortedFiles, initialIndex: index });
    }, [sortedFiles, navigation]);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: C.background }]}>

            {/* Header */}
            <View style={[styles.header, { backgroundColor: C.card, borderBottomColor: C.border }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
                    <ArrowLeft color={C.textHeading} size={24} />
                </TouchableOpacity>
                <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={[styles.title, { color: C.textHeading }]}>⭐ Starred</Text>
                    <Text style={[styles.subtitle, { color: C.textBody }]}>
                        {sortedFiles.length} files · {currentSort.label}
                    </Text>
                </View>
                <TouchableOpacity
                    style={[styles.sortBtn, { backgroundColor: C.background }]}
                    onPress={() => setShowSortModal(true)}
                >
                    <Filter size={15} color={C.primary} />
                    <Text style={[styles.sortBtnText, { color: C.primary }]}>Sort</Text>
                </TouchableOpacity>
            </View>

            {/* File List */}
            {isLoading ? (
                <View style={{ padding: 20 }}>
                    {[1, 2, 3].map(i => <FileCardSkeleton key={i} />)}
                </View>
            ) : sortedFiles.length === 0 ? (
                <View style={styles.empty}>
                    <Star color="#cbd5e1" size={52} />
                    <Text style={[styles.emptyTitle, { color: C.textHeading }]}>No starred files</Text>
                    <Text style={[styles.emptySub, { color: C.textBody }]}>Tap the ⭐ on any file to star it</Text>
                </View>
            ) : (
                <FlatList
                    data={sortedFiles}
                    keyExtractor={item => item.id}
                    contentContainerStyle={styles.list}
                    renderItem={({ item, index }) => (
                        <FileCard
                            key={item.id}
                            item={item}
                            onPress={() => handleOpen(item, index)}
                            onStar={() => handleStar(item.id)}
                            onTrash={() => handleTrash(item.id, item.file_name || item.name || 'this file')}
                            token={token || ''}
                            apiBase={apiClient.defaults.baseURL}
                        />
                    )}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            tintColor={C.primary}
                            onRefresh={() => { setRefreshing(true); fetchStarred(); }}
                        />
                    }
                    windowSize={10}
                    maxToRenderPerBatch={20}
                    removeClippedSubviews
                />
            )}

            {/* Sort Modal */}
            <Modal visible={showSortModal} transparent animationType="slide">
                <TouchableOpacity
                    style={styles.overlay}
                    activeOpacity={1}
                    onPress={() => setShowSortModal(false)}
                >
                    <View style={[styles.sheet, { backgroundColor: C.card }]}>
                        <View style={[styles.handle, { backgroundColor: C.border }]} />
                        <Text style={[styles.sheetTitle, { color: C.textHeading }]}>Sort by</Text>
                        {SORT_OPTIONS.map(opt => (
                            <TouchableOpacity
                                key={opt.key}
                                style={[styles.sortRow, sortKey === opt.key && { backgroundColor: C.primary + '18' }]}
                                onPress={() => { setSortKey(opt.key); setShowSortModal(false); }}
                            >
                                <opt.icon size={18} color={sortKey === opt.key ? C.primary : C.textBody} />
                                <Text style={[
                                    styles.sortLabel,
                                    { color: sortKey === opt.key ? C.primary : C.textHeading },
                                    sortKey === opt.key && { fontWeight: '700' },
                                ]}>
                                    {opt.label}
                                </Text>
                                {sortKey === opt.key && (
                                    <View style={[styles.check, { backgroundColor: C.primary }]}>
                                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>✓</Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                        ))}
                        <View style={{ height: 28 }} />
                    </View>
                </TouchableOpacity>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, height: 60, borderBottomWidth: 1,
    },
    iconBtn: { width: 40, height: 40, justifyContent: 'center' },
    title: { fontSize: 18, fontWeight: '700' },
    subtitle: { fontSize: 12, marginTop: 1 },
    sortBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        paddingHorizontal: 12, height: 34, borderRadius: 20,
    },
    sortBtnText: { fontSize: 13, fontWeight: '600' },
    list: { padding: 20, paddingBottom: 40 },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    emptyTitle: { fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 },
    emptySub: { fontSize: 14 },
    // Sort sheet
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12 },
    handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
    sheetTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
    sortRow: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12, marginBottom: 4,
    },
    sortLabel: { flex: 1, fontSize: 15 },
    check: { width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
});
