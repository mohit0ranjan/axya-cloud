/**
 * FilesScreen.tsx — All Files view with sort, filter tabs, and search
 * Fixes #18: was a bare list with no sort/filter/search UI
 */
import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView, FlatList,
    TouchableOpacity, ActivityIndicator, RefreshControl,
    Alert, TextInput, ScrollView, Modal,
} from 'react-native';
import {
    ArrowLeft, HardDrive, Search, X, SortAsc, SortDesc, Filter,
    Image as ImageIcon, Film, Music, FileText, Archive,
} from 'lucide-react-native';
import { AuthContext } from '../context/AuthContext';
import apiClient from '../services/apiClient';
import FileCard from '../components/FileCard';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import { FileCardSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';

// ─── Constants ────────────────────────────────────────────────────────────────

const SORT_OPTIONS = [
    { key: 'created_at_DESC', label: 'Newest First', icon: SortDesc },
    { key: 'created_at_ASC', label: 'Oldest First', icon: SortAsc },
    { key: 'file_name_ASC', label: 'Name A→Z', icon: SortAsc },
    { key: 'file_name_DESC', label: 'Name Z→A', icon: SortDesc },
    { key: 'file_size_DESC', label: 'Largest First', icon: SortDesc },
    { key: 'file_size_ASC', label: 'Smallest First', icon: SortAsc },
];

const SORT_MAP: Record<string, { col: string; order: string }> = {
    'created_at_DESC': { col: 'created_at', order: 'DESC' },
    'created_at_ASC': { col: 'created_at', order: 'ASC' },
    'file_name_ASC': { col: 'file_name', order: 'ASC' },
    'file_name_DESC': { col: 'file_name', order: 'DESC' },
    'file_size_DESC': { col: 'file_size', order: 'DESC' },
    'file_size_ASC': { col: 'file_size', order: 'ASC' },
};

const FILTER_TABS = [
    { key: 'all', label: 'All', Icon: null },
    { key: 'image', label: '📸 Images', Icon: ImageIcon },
    { key: 'video', label: '🎬 Videos', Icon: Film },
    { key: 'audio', label: '🎵 Audio', Icon: Music },
    { key: 'pdf', label: '📄 Docs', Icon: FileText },
    { key: 'zip', label: '📦 Zips', Icon: Archive },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function FilesScreen({ navigation }: any) {
    const { token } = useContext(AuthContext);
    const { showToast } = useToast();
    const { theme } = useTheme();
    const C = theme.colors;

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [files, setFiles] = useState<any[]>([]);

    // Sort + Filter
    const [sortKey, setSortKey] = useState('created_at_DESC');
    const [filterTab, setFilterTab] = useState('all');
    const [showSortModal, setShowSortModal] = useState(false);

    // Search
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const searchInputRef = useRef<TextInput>(null);

    // Debounced markAccessed tracker — fileId → last accessed timestamp
    const lastAccessedRef = useRef<Map<string, number>>(new Map());

    useEffect(() => { fetchFiles(); }, [sortKey]);

    const fetchFiles = async () => {
        setLoading(true);
        try {
            const { col, order } = SORT_MAP[sortKey] ?? { col: 'created_at', order: 'DESC' };
            const res = await apiClient.get(`/files?limit=500&sort=${col}&order=${order}`);
            if (res.data.success) setFiles(res.data.files);
        } catch {
            showToast('Could not load files', 'error');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    // ── Filter applied client-side (sort is server-side) ─────────────────────
    const filteredFiles = files.filter(item => {
        const matchesType = filterTab === 'all' || item.mime_type?.includes(filterTab);
        const name = (item.file_name || item.name || '').toLowerCase();
        const matchesSearch = !searchQuery.trim() || name.includes(searchQuery.toLowerCase());
        return matchesType && matchesSearch;
    });

    // ── Actions ───────────────────────────────────────────────────────────────

    const handleTrash = (item: any) => {
        Alert.alert('Move to Trash', `Move "${item.file_name || item.name}" to trash?`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Move to Trash', style: 'destructive', onPress: async () => {
                    try {
                        await apiClient.patch(`/files/${item.id}/trash`);
                        setFiles(prev => prev.filter(f => f.id !== item.id));
                        showToast('Moved to trash');
                    } catch { showToast('Failed to trash', 'error'); }
                }
            }
        ]);
    };

    const handleStar = async (item: any) => {
        try {
            await apiClient.patch(`/files/${item.id}/star`);
            setFiles(prev => prev.map(f =>
                f.id === item.id ? { ...f, is_starred: !f.is_starred } : f
            ));
            showToast(item.is_starred ? 'Removed from starred' : 'Added to starred');
        } catch { showToast('Failed to update star', 'error'); }
    };

    // ✅ Fix #29: debounce markAccessed (max once per 5 minutes per file)
    const handleOpen = useCallback((item: any, index: number) => {
        const now = Date.now();
        const lastAccessed = lastAccessedRef.current.get(item.id) ?? 0;
        if (now - lastAccessed > 5 * 60 * 1000) {
            lastAccessedRef.current.set(item.id, now);
            // ✅ Fixed: server route is POST /files/:id/accessed (was PATCH → 404)
            apiClient.post(`/files/${item.id}/accessed`).catch(() => { });
        }
        navigation.navigate('FilePreview', { files: filteredFiles, initialIndex: index });
    }, [filteredFiles, navigation]);

    const currentSort = SORT_OPTIONS.find(s => s.key === sortKey) ?? SORT_OPTIONS[0];

    // ─── Render ───────────────────────────────────────────────────────────────

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: C.background }]}>

            {/* ── Header ── */}
            <View style={[styles.header, { backgroundColor: C.card, borderBottomColor: C.border }]}>
                {showSearch ? (
                    // ── Search bar mode ──
                    <View style={[styles.searchBar, { backgroundColor: C.background, borderColor: C.border }]}>
                        <Search size={16} color={C.textBody} />
                        <TextInput
                            ref={searchInputRef}
                            style={[styles.searchInput, { color: C.textHeading }]}
                            placeholder="Search files…"
                            placeholderTextColor={C.textBody}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            autoFocus
                        />
                        <TouchableOpacity onPress={() => { setSearchQuery(''); setShowSearch(false); }}>
                            <X size={18} color={C.textBody} />
                        </TouchableOpacity>
                    </View>
                ) : (
                    <>
                        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()}>
                            <ArrowLeft color={C.textHeading} size={24} />
                        </TouchableOpacity>
                        <View style={{ flex: 1, marginLeft: 8 }}>
                            <Text style={[styles.headerTitle, { color: C.textHeading }]}>All Files</Text>
                            <Text style={[styles.headerSub, { color: C.textBody }]}>
                                {filteredFiles.length} files · {currentSort.label}
                            </Text>
                        </View>
                        {/* Sort button */}
                        <TouchableOpacity
                            style={[styles.iconBtn, styles.sortBtn, { backgroundColor: C.background }]}
                            onPress={() => setShowSortModal(true)}
                        >
                            <Filter size={16} color={C.primary} />
                            <Text style={[styles.sortBtnText, { color: C.primary }]} numberOfLines={1}>
                                {currentSort.label.split(' ').slice(0, 2).join(' ')}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.iconBtn} onPress={() => setShowSearch(true)}>
                            <Search color={C.textHeading} size={22} />
                        </TouchableOpacity>
                    </>
                )}
            </View>

            {/* ── Filter tabs ── */}
            <View style={[styles.tabsWrapper, { backgroundColor: C.card, borderBottomColor: C.border }]}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.tabsScroll}
                >
                    {FILTER_TABS.map(t => (
                        <TouchableOpacity
                            key={t.key}
                            style={[styles.tab, filterTab === t.key && { backgroundColor: C.primary }]}
                            onPress={() => setFilterTab(t.key)}
                        >
                            <Text style={[styles.tabText, filterTab === t.key && { color: '#fff' }]}>
                                {t.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* ── File list ── */}
            {loading ? (
                <View style={styles.listPad}>
                    {[1, 2, 3, 4, 5].map(i => <FileCardSkeleton key={i} />)}
                </View>
            ) : filteredFiles.length === 0 ? (
                <EmptyState
                    title={searchQuery ? 'No results found' : filterTab !== 'all' ? 'No files found' : 'No files uploaded yet'}
                    description={searchQuery ? 'Try a different keyword' : filterTab !== 'all' ? 'Try changing your filter' : 'Upload files to see them here'}
                    iconType={searchQuery || filterTab !== 'all' ? 'search' : 'file'}
                />
            ) : (
                <FlatList
                    data={filteredFiles}
                    keyExtractor={item => item.id}
                    contentContainerStyle={styles.listPad}
                    renderItem={({ item, index }) => (
                        <FileCard
                            item={item}
                            token={token || undefined}
                            apiBase={apiClient.defaults.baseURL}
                            onPress={() => handleOpen(item, index)}
                            onTrash={() => handleTrash(item)}
                            onStar={() => handleStar(item)}
                        />
                    )}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={() => { setRefreshing(true); fetchFiles(); }}
                            tintColor={C.primary}
                        />
                    }
                    windowSize={10}
                    maxToRenderPerBatch={20}
                    removeClippedSubviews
                />
            )}

            {/* ── Sort Modal ── */}
            <Modal visible={showSortModal} transparent animationType="slide">
                <TouchableOpacity
                    style={styles.modalOverlay}
                    activeOpacity={1}
                    onPress={() => setShowSortModal(false)}
                >
                    <View style={[styles.sortSheet, { backgroundColor: C.card }]}>
                        <View style={[styles.sortHandle, { backgroundColor: C.border }]} />
                        <Text style={[styles.sortTitle, { color: C.textHeading }]}>Sort by</Text>
                        {SORT_OPTIONS.map(opt => (
                            <TouchableOpacity
                                key={opt.key}
                                style={[styles.sortRow, sortKey === opt.key && { backgroundColor: C.primary + '18' }]}
                                onPress={() => { setSortKey(opt.key); setShowSortModal(false); }}
                            >
                                <opt.icon
                                    size={18}
                                    color={sortKey === opt.key ? C.primary : C.textBody}
                                />
                                <Text style={[
                                    styles.sortRowText,
                                    { color: sortKey === opt.key ? C.primary : C.textHeading },
                                    sortKey === opt.key && { fontWeight: '700' },
                                ]}>
                                    {opt.label}
                                </Text>
                                {sortKey === opt.key && (
                                    <View style={[styles.sortCheck, { backgroundColor: C.primary }]}>
                                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>✓</Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                        ))}
                        <View style={{ height: 24 }} />
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
        paddingHorizontal: 16, height: 60,
        borderBottomWidth: 1,
    },
    iconBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    sortBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 10, borderRadius: 20, height: 34,
        maxWidth: 130,
    },
    sortBtnText: { fontSize: 12, fontWeight: '600' },
    headerTitle: { fontSize: 18, fontWeight: '700' },
    headerSub: { fontSize: 12, marginTop: 1 },
    searchBar: {
        flex: 1, flexDirection: 'row', alignItems: 'center',
        borderRadius: 12, paddingHorizontal: 12, height: 40,
        borderWidth: 1, gap: 8,
    },
    searchInput: { flex: 1, fontSize: 15 },
    tabsWrapper: { borderBottomWidth: 1 },
    tabsScroll: { paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: 'center' },
    tab: {
        paddingHorizontal: 14, paddingVertical: 7,
        borderRadius: 20, backgroundColor: '#f1f5f9',
    },
    tabText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
    listPad: { padding: 20 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    emptyText: { marginTop: 15, fontSize: 16, fontWeight: '500' },
    // Sort modal
    modalOverlay: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'flex-end',
    },
    sortSheet: {
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingHorizontal: 20, paddingTop: 12,
    },
    sortHandle: {
        width: 36, height: 4, borderRadius: 2,
        alignSelf: 'center', marginBottom: 16,
    },
    sortTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
    sortRow: {
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 14, paddingHorizontal: 12,
        borderRadius: 12, marginBottom: 4,
    },
    sortRowText: { flex: 1, fontSize: 15 },
    sortCheck: {
        width: 20, height: 20, borderRadius: 10,
        justifyContent: 'center', alignItems: 'center',
    },
});
