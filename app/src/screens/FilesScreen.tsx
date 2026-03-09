/**
 * FilesScreen.tsx â€” All Files view with sort, filter tabs, and search
 * Fixes #18: was a bare list with no sort/filter/search UI
 */
import React, { useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView, FlatList,
    TouchableOpacity, ActivityIndicator, RefreshControl,
    Alert, TextInput, ScrollView, Modal,
} from 'react-native';
import {
    ArrowLeft, HardDrive, Search, X, SortAsc, SortDesc, Filter,
    Image as ImageIcon, Film, Music, FileText, Archive,
    Share2, Tag, Info, Star, Move, Trash2
} from 'lucide-react-native';
import { AuthContext } from '../context/AuthContext';
import apiClient from '../services/apiClient';
import FileCard from '../components/FileCard';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import { FileCardSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SORT_OPTIONS = [
    { key: 'created_at_DESC', label: 'Newest First', icon: SortDesc },
    { key: 'created_at_ASC', label: 'Oldest First', icon: SortAsc },
    { key: 'file_name_ASC', label: 'Name A-Z', icon: SortAsc },
    { key: 'file_name_DESC', label: 'Name Z-A', icon: SortDesc },
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
    { key: 'image', label: 'Images', Icon: ImageIcon },
    { key: 'video', label: 'Videos', Icon: Film },
    { key: 'audio', label: 'Audio', Icon: Music },
    { key: 'pdf', label: 'Docs', Icon: FileText },
    { key: 'zip', label: 'Zips', Icon: Archive },
];

// â”€â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function FilesScreen({ navigation }: any) {
    const { token } = useContext(AuthContext);
    const { showToast } = useToast();
    const { theme, isDark } = useTheme();
    const C = theme.colors;

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [files, setFiles] = useState<any[]>([]);

    // âœ… Fix 1.1: client-side pagination â€” renders 50 rows at a time
    const [displayLimit, setDisplayLimit] = useState(50);

    // Sort + Filter
    const [sortKey, setSortKey] = useState('created_at_DESC');
    const [filterTab, setFilterTab] = useState('all');
    const [showSortModal, setShowSortModal] = useState(false);

    // Search
    const [searchQuery, setSearchQuery] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const searchInputRef = useRef<TextInput>(null);
    const mountedRef = useRef(true);

    // Options Modal
    const [optionsTarget, setOptionsTarget] = useState<any>(null);

    // Debounced markAccessed tracker â€” fileId â†’ last accessed timestamp
    const lastAccessedRef = useRef<Map<string, number>>(new Map());

    // Reset display limit when filter/search/sort changes
    useEffect(() => {
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => { setDisplayLimit(50); }, [filterTab, searchQuery]);

    const fetchFiles = useCallback(async () => {
        setLoading(true);
        try {
            const { col, order } = SORT_MAP[sortKey] ?? { col: 'created_at', order: 'DESC' };
            const res = await apiClient.get(`/files?limit=500&sort=${col}&order=${order}`);
            if (mountedRef.current && res.data.success) setFiles(res.data.files);
        } catch {
            if (mountedRef.current) showToast('Could not load files', 'error');
        } finally {
            if (mountedRef.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, [showToast, sortKey]);

    useEffect(() => { fetchFiles(); }, [fetchFiles]);

    // â”€â”€ Filter applied client-side (sort is server-side) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const filteredFiles = useMemo(() => files.filter(item => {
        const matchesType = filterTab === 'all' || item.mime_type?.includes(filterTab);
        const name = (item.file_name || item.name || '').toLowerCase();
        const matchesSearch = !searchQuery.trim() || name.includes(searchQuery.toLowerCase());
        return matchesType && matchesSearch;
    }), [files, filterTab, searchQuery]);

    // â”€â”€ Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    // âœ… Fix #29: debounce markAccessed (max once per 5 minutes per file)
    const handleOpen = useCallback((item: any, index: number) => {
        const now = Date.now();
        const lastAccessed = lastAccessedRef.current.get(item.id) ?? 0;
        if (now - lastAccessed > 5 * 60 * 1000) {
            lastAccessedRef.current.set(item.id, now);
            // âœ… Fixed: server route is POST /files/:id/accessed (was PATCH â†’ 404)
            apiClient.post(`/files/${item.id}/accessed`).catch(() => { });
        }
        navigation.navigate('FilePreview', { files: filteredFiles, initialIndex: index });
    }, [filteredFiles, navigation]);

    const currentSort = SORT_OPTIONS.find(s => s.key === sortKey) ?? SORT_OPTIONS[0];
    const renderFileCard = useCallback(({ item, index }: any) => (
        <FileCard
            item={item}
            token={token || undefined}
            apiBase={apiClient.defaults.baseURL}
            onPress={() => handleOpen(item, index)}
            onOptions={() => setOptionsTarget(item)}
        />
    ), [handleOpen, token]);

    // â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: C.background }]}>

            {/* â”€â”€ Header â”€â”€ */}
            <View style={[styles.header, { backgroundColor: C.card, borderBottomColor: C.border }]}>
                {showSearch ? (
                    // â”€â”€ Search bar mode â”€â”€
                    <View style={[styles.searchBar, { backgroundColor: C.background, borderColor: C.border }]}>
                        <Search size={16} color={C.textBody} />
                        <TextInput
                            ref={searchInputRef}
                            style={[styles.searchInput, { color: C.textHeading }]}
                            placeholder="Search files..."
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

            {/* â”€â”€ Filter tabs â”€â”€ */}
            <View style={[styles.tabsWrapper, { backgroundColor: C.card, borderBottomColor: C.border }]}>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.tabsScroll}
                >
                    {FILTER_TABS.map(t => (
                        <TouchableOpacity
                            key={t.key}
                            style={[styles.tab, { backgroundColor: filterTab === t.key ? C.primary : C.border }]}
                            onPress={() => setFilterTab(t.key)}
                        >
                            <Text style={[styles.tabText, { color: filterTab === t.key ? '#fff' : C.textBody }]}>
                                {t.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            {/* â”€â”€ File list â”€â”€ */}
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
                    data={filteredFiles.slice(0, displayLimit)}
                    keyExtractor={item => item.id}
                    contentContainerStyle={styles.listPad}
                    renderItem={renderFileCard}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            onRefresh={() => { setRefreshing(true); fetchFiles(); }}
                            tintColor={C.primary}
                        />
                    }
                    // âœ… Fix 2.1: getItemLayout for O(1) scroll â€” prevents blank gaps
                    getItemLayout={(_data, index) => ({ length: 72, offset: 72 * index, index })}
                    // âœ… Fix 1.1: load more rows when user reaches bottom
                    onEndReached={() => setDisplayLimit(prev => prev + 50)}
                    onEndReachedThreshold={0.3}
                    windowSize={10}
                    maxToRenderPerBatch={20}
                />
            )}

            {/* â”€â”€ Sort Modal â”€â”€ */}
            <Modal visible={showSortModal} transparent animationType="slide">
                <TouchableOpacity
                    style={[styles.modalOverlay, { backgroundColor: C.overlay }]}
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
                                    sortKey === opt.key && { fontWeight: '600' },
                                ]}>
                                    {opt.label}
                                </Text>
                                {sortKey === opt.key && (
                                    <View style={[styles.sortCheck, { backgroundColor: C.primary }]}>
                                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '600' }}>✓</Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                        ))}
                        <View style={{ height: 24 }} />
                    </View>
                </TouchableOpacity>
            </Modal>
            <Modal visible={!!optionsTarget} transparent animationType="slide">
                <TouchableOpacity
                    style={[styles.modalOverlay, { backgroundColor: C.overlay }]}
                    activeOpacity={1}
                    onPress={() => setOptionsTarget(null)}
                >
                    <View style={[styles.optionsSheet, { backgroundColor: C.card }]}>
                        <View style={styles.sheetHandle} />
                        <Text style={[styles.optionsTitle, { color: C.textHeading }]} numberOfLines={1}>{optionsTarget?.name || optionsTarget?.file_name}</Text>

                        <TouchableOpacity style={[styles.optionItem, { backgroundColor: C.border }]} onPress={() => { setOptionsTarget(null); handleStar(optionsTarget); }}>
                            <Star color={optionsTarget?.is_starred ? C.accent : C.textBody} size={20} fill={optionsTarget?.is_starred ? C.accent : 'transparent'} />
                            <Text style={[styles.optionText, { color: C.textHeading }]}>{optionsTarget?.is_starred ? 'Unstar file' : 'Star file'}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={[styles.optionItem, { backgroundColor: isDark ? 'rgba(239,68,68,0.12)' : '#fee2e2', marginTop: 8 }]} onPress={() => { setOptionsTarget(null); handleTrash(optionsTarget); }}>
                            <Trash2 color={C.danger} size={20} />
                            <Text style={[styles.optionText, { color: C.danger }]}>Move to Trash</Text>
                        </TouchableOpacity>

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
    iconBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
    sortBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 10, borderRadius: 20, height: 44,
        maxWidth: 130,
    },
    sortBtnText: { fontSize: 12, fontWeight: '600' },
    headerTitle: { fontSize: 18, fontWeight: '600' },
    headerSub: { fontSize: 12, marginTop: 1 },
    searchBar: {
        flex: 1, flexDirection: 'row', alignItems: 'center',
        borderRadius: 12, paddingHorizontal: 12, height: 44,
        borderWidth: 1, gap: 8,
    },
    searchInput: { flex: 1, fontSize: 15 },
    tabsWrapper: { borderBottomWidth: 1 },
    tabsScroll: { paddingHorizontal: 16, paddingVertical: 8, gap: 8, alignItems: 'center' },
    tab: {
        paddingHorizontal: 14, paddingVertical: 7,
        borderRadius: 20,
    },
    tabText: { fontSize: 12, fontWeight: '600' },
    listPad: { padding: 20 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    emptyText: { marginTop: 15, fontSize: 16, fontWeight: '500' },
    // Sort modal
    modalOverlay: {
        flex: 1,
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
    sortTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
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
    optionsSheet: {
        borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40,
    },
    sheetHandle: {
        width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 20,
    },
    optionsTitle: { fontSize: 20, fontWeight: '600', marginBottom: 24 },
    optionItem: {
        flexDirection: 'row', alignItems: 'center', gap: 14,
        paddingVertical: 14, paddingHorizontal: 16,
        borderRadius: 14, marginBottom: 8
    },
    optionText: { fontSize: 16, fontWeight: '600' },
});

