/**
 * AllFilesScreen.tsx – Shows all individual files across all folders
 * Updated: sort functionality, standardized tokens, consistent header
 */
import React, { useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView, FlatList,
    TouchableOpacity, RefreshControl, Modal,
    TextInput, Dimensions,
} from 'react-native';
import {
    ArrowLeft, Search, X, SortAsc, SortDesc, Filter
} from 'lucide-react-native';
import { AuthContext } from '../context/AuthContext';
import apiClient from '../services/apiClient';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import { FileCardSkeleton, ContentFadeIn } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import FileListItem from '../components/FileListItem';
import FileQuickActions from '../components/FileQuickActions';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFileRefresh, useOptimisticFiles } from '../utils/events';
import { normalizeItems, sortItems } from '../services/fileStateSync';

const SORT_OPTIONS = [
    { key: 'created_at_DESC', label: 'Newest First', icon: SortDesc },
    { key: 'created_at_ASC', label: 'Oldest First', icon: SortAsc },
    { key: 'file_name_ASC', label: 'Name A→Z', icon: SortAsc },
    { key: 'file_name_DESC', label: 'Name Z→A', icon: SortDesc },
    { key: 'file_size_DESC', label: 'Largest First', icon: SortDesc },
    { key: 'file_size_ASC', label: 'Smallest First', icon: SortAsc },
];

export default function AllFilesScreen({ navigation }: any) {
    const { token } = useContext(AuthContext);
    const { showToast } = useToast();
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const C = theme.colors;

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [files, setFiles] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [optionsTarget, setOptionsTarget] = useState<any>(null);
    const [sortKey, setSortKey] = useState('created_at_DESC');
    const [showSortModal, setShowSortModal] = useState(false);
    const mountedRef = useRef(true);

    const fetchFiles = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiClient.get('/files?limit=1000&sort=created_at&order=DESC');
            if (mountedRef.current && res.data.success) {
                setFiles(normalizeItems(res.data.files || [], 'created_at_DESC'));
            }
        } catch {
            if (mountedRef.current) showToast('Could not load files', 'error');
        } finally {
            if (mountedRef.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, [showToast]);

    useEffect(() => {
        fetchFiles();
        return () => { mountedRef.current = false; };
    }, [fetchFiles]);

    useFileRefresh(() => { fetchFiles(); });
    useOptimisticFiles(setFiles);

    const sortedFiles = useMemo(() => sortItems(files, sortKey as any), [files, sortKey]);

    const filteredFiles = useMemo(() => {
        if (!searchQuery.trim()) return sortedFiles;
        const q = searchQuery.toLowerCase();
        return sortedFiles.filter(f => (f.file_name || f.name || '').toLowerCase().includes(q));
    }, [sortedFiles, searchQuery]);

    const currentSort = SORT_OPTIONS.find(s => s.key === sortKey) ?? SORT_OPTIONS[0];

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchFiles();
    }, [fetchFiles]);

    const handleBack = useCallback(() => {
        if (navigation?.canGoBack?.()) { navigation.goBack(); return; }
        navigation?.navigate?.('MainTabs', { screen: 'Home' });
    }, [navigation]);

    const renderFile = useCallback(({ item }: any) => (
        <FileListItem
            item={item}
            token={token}
            apiBaseUrl={apiClient.defaults.baseURL || ''}
            theme={theme}
            isDark={isDark}
            onPress={() => {
                const idx = filteredFiles.findIndex(f => f.id === item.id);
                navigation.navigate('FilePreview', { files: filteredFiles, initialIndex: idx === -1 ? 0 : idx });
            }}
            onOptionsPress={(item) => setOptionsTarget(item)}
        />
    ), [filteredFiles, navigation, theme, isDark, token]);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: C.background }]}>
            {/* Header */}
            <View style={[styles.header, { backgroundColor: C.background, borderBottomColor: C.border }]}>
                <TouchableOpacity onPress={handleBack} style={styles.iconBtn} activeOpacity={0.7}>
                    <ArrowLeft color={C.textHeading} size={24} />
                </TouchableOpacity>
                <View style={styles.headerInfo}>
                    <Text style={[styles.headerTitle, { color: C.textHeading }]} numberOfLines={1}>All Files</Text>
                    <Text style={[styles.headerSub, { color: C.textBody }]} numberOfLines={1}>
                        {files.length} item{files.length !== 1 ? 's' : ''} · {currentSort.label}
                    </Text>
                </View>
                <TouchableOpacity
                    style={[styles.sortBtn, { backgroundColor: C.background }]}
                    onPress={() => setShowSortModal(true)}
                    activeOpacity={0.7}
                >
                    <Filter size={15} color={C.primary} />
                    <Text style={[styles.sortBtnText, { color: C.primary }]}>Sort</Text>
                </TouchableOpacity>
            </View>

            {/* Search */}
            <View style={[styles.searchBar, { backgroundColor: C.card, borderColor: C.border }]}>
                <Search size={18} color={C.textBody} />
                <TextInput
                    style={[styles.searchInput, { color: C.textHeading }]}
                    placeholder="Search files..."
                    placeholderTextColor={C.textBody}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                />
                {searchQuery ? (
                    <TouchableOpacity onPress={() => setSearchQuery('')} activeOpacity={0.7}>
                        <X size={18} color={C.textBody} />
                    </TouchableOpacity>
                ) : null}
            </View>

            {/* List */}
            {loading ? (
                <View style={styles.listPad}>
                    {[0, 1, 2, 3, 4].map(i => <FileCardSkeleton key={i} index={i} />)}
                </View>
            ) : filteredFiles.length === 0 ? (
                <EmptyState
                    title={searchQuery ? 'No results found' : 'No files yet'}
                    description={searchQuery ? 'Try a different keyword' : 'Upload files to get started'}
                    iconType="file"
                    style={{ paddingVertical: 80, flex: 0 }}
                />
            ) : (
                <ContentFadeIn visible={!loading} style={{ flex: 1 }}>
                <FlatList
                    data={filteredFiles}
                    keyExtractor={item => item.id}
                    renderItem={renderFile}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.listPad}
                    windowSize={5}
                    maxToRenderPerBatch={8}
                    initialNumToRender={10}
                    removeClippedSubviews
                />
                </ContentFadeIn>
            )}

            <FileQuickActions
                item={optionsTarget}
                visible={!!optionsTarget}
                onClose={() => setOptionsTarget(null)}
                onRefresh={fetchFiles}
            />

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
                                activeOpacity={0.7}
                            >
                                <opt.icon size={18} color={sortKey === opt.key ? C.primary : C.textBody} />
                                <Text style={[
                                    styles.sortLabel,
                                    { color: sortKey === opt.key ? C.primary : C.textHeading },
                                    sortKey === opt.key && { fontWeight: '700' as const },
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
        paddingHorizontal: 20, paddingVertical: 16,
        borderBottomWidth: 1, gap: 12,
    },
    iconBtn: { width: 40, height: 40, justifyContent: 'center' },
    headerInfo: { flex: 1 },
    headerTitle: { fontSize: 24, fontWeight: '700' },
    headerSub: { fontSize: 12, marginTop: 2, fontWeight: '500' },
    sortBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        paddingHorizontal: 12, height: 34, borderRadius: 20,
    },
    sortBtnText: { fontSize: 13, fontWeight: '600' },
    searchBar: {
        flexDirection: 'row', alignItems: 'center',
        borderRadius: 12, paddingHorizontal: 14, height: 46,
        marginHorizontal: 20, marginVertical: 12, gap: 10,
        borderWidth: 1,
    },
    searchInput: { flex: 1, fontSize: 15 },
    listPad: { paddingVertical: 12, paddingHorizontal: 20 },
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
