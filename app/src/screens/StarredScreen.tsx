/**
 * StarredScreen.tsx — Starred files using FileListItem for consistency
 */
import React, { useState, useEffect, useContext, useCallback, useRef, useMemo } from 'react';
import {
    View, Text, StyleSheet, FlatList, TouchableOpacity,
    RefreshControl, Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, SortAsc, SortDesc, Filter } from 'lucide-react-native';
import apiClient from '../services/apiClient';
import { useToast } from '../context/ToastContext';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import FileListItem from '../components/FileListItem';
import FileQuickActions from '../components/FileQuickActions';
import { FileCardSkeleton, ContentFadeIn } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useFileRefresh, useOptimisticFiles } from '../utils/events';
import { normalizeItems, sortItems, syncAfterFileMutation } from '../services/fileStateSync';

const SORT_OPTIONS = [
    { key: 'created_at_DESC', label: 'Newest First', icon: SortDesc },
    { key: 'created_at_ASC', label: 'Oldest First', icon: SortAsc },
    { key: 'file_name_ASC', label: 'Name A→Z', icon: SortAsc },
    { key: 'file_name_DESC', label: 'Name Z→A', icon: SortDesc },
    { key: 'file_size_DESC', label: 'Largest First', icon: SortDesc },
    { key: 'file_size_ASC', label: 'Smallest First', icon: SortAsc },
];

export default function StarredScreen({ navigation }: any) {
    const { showToast } = useToast();
    const { token } = useContext(AuthContext);
    const { theme, isDark } = useTheme();
    const C = theme.colors;
    const insets = useSafeAreaInsets();

    const [isLoading, setIsLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [files, setFiles] = useState<any[]>([]);
    const [sortKey, setSortKey] = useState('created_at_DESC');
    const [showSortModal, setShowSortModal] = useState(false);
    const [optionsTarget, setOptionsTarget] = useState<any>(null);

    const lastAccessedRef = useRef<Map<string, number>>(new Map());
    const mountedRef = useRef(true);

    useEffect(() => { return () => { mountedRef.current = false; }; }, []);
    useEffect(() => { fetchStarred(); }, []);
    useFileRefresh(() => { fetchStarred(); });
    useOptimisticFiles(setFiles);

    const fetchStarred = async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get('/files/starred');
            if (mountedRef.current && res.data.success) {
                setFiles(normalizeItems(res.data.files || [], 'created_at_DESC'));
            }
        } catch { if (mountedRef.current) showToast('Could not load starred files', 'error'); }
        finally { if (mountedRef.current) { setIsLoading(false); setRefreshing(false); } }
    };

    const sortedFiles = sortItems(files, sortKey as any);
    const currentSort = SORT_OPTIONS.find(s => s.key === sortKey) ?? SORT_OPTIONS[0];

    const handleBack = () => {
        if (navigation?.canGoBack?.()) { navigation.goBack(); return; }
        navigation?.navigate?.('MainTabs', { screen: 'Home' });
    };

    const handleOpen = useCallback((item: any, isFolder: boolean) => {
        if (isFolder) return;
        const index = sortedFiles.findIndex((f: any) => f.id === item.id);
        const now = Date.now();
        const last = lastAccessedRef.current.get(item.id) ?? 0;
        if (now - last > 5 * 60 * 1000) {
            lastAccessedRef.current.set(item.id, now);
            apiClient.post(`/files/${item.id}/accessed`).catch(() => {});
        }
        navigation.navigate('FilePreview', { files: sortedFiles, initialIndex: Math.max(index, 0) });
    }, [sortedFiles, navigation]);

    return (
        <View style={[styles.container, { backgroundColor: C.background, paddingTop: insets.top }]}>
            {/* Header — matches AllFilesScreen pattern */}
            <View style={[styles.header, { backgroundColor: C.background, borderBottomColor: C.border }]}>
                <TouchableOpacity onPress={handleBack} style={styles.iconBtn} activeOpacity={0.7}>
                    <ArrowLeft color={C.textHeading} size={24} />
                </TouchableOpacity>
                <View style={styles.headerInfo}>
                    <Text style={[styles.title, { color: C.textHeading }]} numberOfLines={1}>Starred</Text>
                    <Text style={[styles.subtitle, { color: C.textBody }]} numberOfLines={1}>
                        {sortedFiles.length} file{sortedFiles.length !== 1 ? 's' : ''} · {currentSort.label}
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

            {/* File List */}
            {isLoading ? (
                <View style={{ padding: 20 }}>
                    {[0, 1, 2, 3, 4].map(i => <FileCardSkeleton key={i} index={i} />)}
                </View>
            ) : sortedFiles.length === 0 ? (
                <EmptyState
                    title="No starred files"
                    description="Tap the star icon on any file to add it here"
                    iconType="file"
                />
            ) : (
                <ContentFadeIn visible={!isLoading} style={{ flex: 1 }}>
                <FlatList
                    data={sortedFiles}
                    keyExtractor={item => item.id}
                    contentContainerStyle={styles.list}
                    renderItem={({ item }) => (
                        <FileListItem
                            item={item}
                            token={token || ''}
                            apiBaseUrl={apiClient.defaults.baseURL || ''}
                            theme={theme}
                            isDark={isDark}
                            onPress={handleOpen}
                            onOptionsPress={setOptionsTarget}
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
                </ContentFadeIn>
            )}

            {/* Quick Actions Bottom Sheet */}
            <FileQuickActions
                item={optionsTarget}
                visible={!!optionsTarget}
                onClose={() => setOptionsTarget(null)}
                onRefresh={fetchStarred}
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
        </View>
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
    title: { fontSize: 24, fontWeight: '700' },
    subtitle: { fontSize: 12, color: '#64748B', marginTop: 2, fontWeight: '500' },
    sortBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        paddingHorizontal: 12, height: 34, borderRadius: 20,
    },
    sortBtnText: { fontSize: 13, fontWeight: '600' },
    list: { paddingVertical: 12, paddingHorizontal: 20 },
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
