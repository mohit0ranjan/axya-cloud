import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import {
    View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView,
    Alert, Platform, Modal, TextInput, KeyboardAvoidingView,
    Dimensions, FlatList, Animated, ActivityIndicator,
} from 'react-native';
import {
    ArrowLeft, Trash2, FileText, Image as ImageIcon, Video, Music, Plus, Folder,
    MoreHorizontal, Star, Grid, List, Info, Move, Tag, CheckSquare, Square,
    SortAsc, SortDesc, Filter, X, Check, Share2, ShieldCheck, Search
} from 'lucide-react-native';
import { Image } from '../components/AppImage';
import * as DocumentPicker from 'expo-document-picker';
import apiClient from '../services/apiClient';
import { AuthContext } from '../context/AuthContext';
import { useUpload } from '../context/UploadContext';
import { useToast } from '../context/ToastContext';
import { theme as staticTheme } from '../ui/theme';
import { useTheme } from '../context/ThemeContext';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { FileCardSkeleton } from '../ui/Skeleton';
import ShareFolderModal from '../components/ShareFolderModal';
import { FileIcon } from '../components/FileIcon';


const { width } = Dimensions.get('window');

const FILTER_TABS = [
    { key: 'all', label: 'All', Icon: null },
    { key: 'image', label: 'Images', Icon: ImageIcon },
    { key: 'video', label: 'Videos', Icon: Video },
    { key: 'audio', label: 'Audio', Icon: Music },
    { key: 'pdf', label: 'Docs', Icon: FileText },
    { key: 'folder', label: 'Folders', Icon: Folder },
];

const SORT_OPTIONS = [
    { key: 'created_at_DESC', label: 'Newest First' },
    { key: 'created_at_ASC', label: 'Oldest First' },
    { key: 'file_name_ASC', label: 'Name A-Z' },
    { key: 'file_name_DESC', label: 'Name Z-A' },
    { key: 'file_size_DESC', label: 'Largest First' },
    { key: 'file_size_ASC', label: 'Smallest First' },
];

const COLORS = ['#4B6EF5', '#1FD45A', '#FCBD0B', '#EF4444', '#9333EA', '#0D9488', '#F97316', '#EC4899'];
const PAGE_SIZE = 50;

function formatSize(bytes: number) {
    if (!bytes) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
}

// ? Fix: React.memo wrapper prevents unchanged files from re-rendering when selectedIds updates
const MemoizedFileItem = React.memo(({ item, isSelected, isGridView, selectMode, theme, token, onAction }: any) => {
    const isFolder = item.result_type === 'folder' || item.mime_type === 'inode/directory';

    return (
        <TouchableOpacity
            style={[isGridView ? styles.gridCard : styles.fileCard,
            { backgroundColor: isGridView ? theme.colors.card : theme.colors.background },
            isSelected && styles.fileCardSelected]}
            onPress={() => onAction(selectMode ? 'toggle' : isFolder ? 'openFolder' : 'preview', item)}
            onLongPress={() => onAction('longPress', item)}
        >
            {isGridView ? (
                <>
                    <View style={styles.gridIcon}>
                        <FileIcon item={item} size={GRID_SIZE * 0.75} token={token} apiBase={apiClient.defaults.baseURL} themeColors={theme.colors} style={{ borderRadius: 0, width: '100%', height: '100%' }} />
                    </View>
                    <View style={styles.gridLabel}>
                        <Text style={styles.gridName} numberOfLines={1}>{item.name || item.file_name}</Text>
                    </View>
                    {selectMode && (
                        <View style={styles.gridCheckbox}>
                            {isSelected && <Check color={theme.colors.primary} size={14} />}
                        </View>
                    )}
                </>
            ) : (
                <>
                    <FileIcon item={item} size={46} token={token} apiBase={apiClient.defaults.baseURL} themeColors={theme.colors} style={{ marginRight: 14 }} />
                    <View style={styles.fileDetails}>
                        <Text style={styles.fileName} numberOfLines={1}>{item.name || item.file_name}</Text>
                        <Text style={styles.fileMeta}>
                            {isFolder
                                ? `Folder${item.file_count != null ? ` · ${item.file_count} items` : ''}`
                                : `${formatSize(item.size)} · ${new Date(item.created_at).toLocaleDateString()}`
                            }
                        </Text>
                    </View>
                    {!selectMode && (
                        <TouchableOpacity
                            style={styles.moreBtn}
                            hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
                            onPress={(e: any) => {
                                if (e && e.stopPropagation) e.stopPropagation();
                                if (e && e.preventDefault) e.preventDefault();
                                onAction('options', item);
                            }}
                        >
                            <MoreHorizontal color={theme.colors.textBody} size={20} />
                        </TouchableOpacity >
                    )}
                </>
            )}
        </TouchableOpacity>
    );
}, (prev, next) => {
    // Custom comparator to skip massive re-renders
    return prev.item.id === next.item.id &&
        prev.item.updated_at === next.item.updated_at &&
        prev.item.is_starred === next.item.is_starred &&
        prev.item.name === next.item.name &&
        prev.isSelected === next.isSelected &&
        prev.isGridView === next.isGridView &&
        prev.selectMode === next.selectMode;
});

export default function FolderFilesScreen({ route, navigation }: any) {
    const { folderId, folderName, breadcrumb = [] } = route.params;
    const { theme } = useTheme();
    const { showToast } = useToast();
    const { token } = useContext(AuthContext);

    // ? Fix #29: debounce markAccessed — max 1 DB write per file per 5 min
    const lastAccessedRef = useRef<Map<string, number>>(new Map());

    // Core data
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [files, setFiles] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');

    // Client-side pagination — render in batches of PAGE_SIZE
    const [displayLimit, setDisplayLimit] = useState(PAGE_SIZE);

    // View state
    const [filterTab, setFilterTab] = useState('all');
    const [sortKey, setSortKey] = useState('created_at_DESC');
    const [isGridView, setIsGridView] = useState(false);
    const [showSortModal, setShowSortModal] = useState(false);

    // Multi-select
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const { addUpload } = useUpload();


    // Upload
    const [isUploadSettingsVisible, setUploadSettingsVisible] = useState(false);

    // Modals
    const [isCreateModalVisible, setCreateModalVisible] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [folderColor, setFolderColor] = useState(COLORS[0]);
    const [isRenameModalVisible, setRenameModalVisible] = useState(false);
    const [renameTarget, setRenameTarget] = useState<any>(null);
    const [renameValue, setRenameValue] = useState('');

    // File Info Sheet
    const [infoFile, setInfoFile] = useState<any>(null);
    const [infoTags, setInfoTags] = useState<string[]>([]);
    const [infoShareLink, setInfoShareLink] = useState<any>(null);
    const [newTagInput, setNewTagInput] = useState('');

    // Share Modal
    const [isShareModalVisible, setShareModalVisible] = useState(false);
    const [shareTarget, setShareTarget] = useState<any>(null);
    const closeShareModal = () => {
        setShareModalVisible(false);
        setTimeout(() => setShareTarget(null), 220);
    };

    // Move modal
    const [isMoveModalVisible, setMoveModalVisible] = useState(false);
    const [allFolders, setAllFolders] = useState<any[]>([]);
    const [moveTarget, setMoveTarget] = useState<any>(null);

    // Options Modal
    const [optionsTarget, setOptionsTarget] = useState<any>(null);

    useEffect(() => { fetchFolderFiles(); }, [folderId, sortKey]);

    // Reset display limit when filter/search changes
    useEffect(() => { setDisplayLimit(PAGE_SIZE); }, [filterTab, searchQuery]);

    const fetchFolderFiles = async () => {
        setIsLoading(true);
        setLoadError('');
        try {
            // ? Robust sort key parsing using a lookup table
            // Avoids brittle split('_') logic that breaks on keys like 'created_at_DESC'
            const SORT_MAP: Record<string, { col: string; order: string }> = {
                'created_at_DESC': { col: 'created_at', order: 'DESC' },
                'created_at_ASC': { col: 'created_at', order: 'ASC' },
                'file_name_ASC': { col: 'file_name', order: 'ASC' },
                'file_name_DESC': { col: 'file_name', order: 'DESC' },
                'file_size_DESC': { col: 'file_size', order: 'DESC' },
                'file_size_ASC': { col: 'file_size', order: 'ASC' },
            };
            const { col: sortCol, order: sortOrder } = SORT_MAP[sortKey] ?? { col: 'created_at', order: 'DESC' };

            const [filesRes, foldersRes] = await Promise.all([
                apiClient.get(`/files?folder_id=${encodeURIComponent(folderId)}&sort=${sortCol}&order=${sortOrder}&limit=1000`),
                apiClient.get(`/files/folders?parent_id=${encodeURIComponent(folderId)}`),
            ]);
            let merged: any[] = [];
            if (foldersRes.data.success) {
                merged = foldersRes.data.folders.map((f: any) => ({
                    ...f, name: f.name, mime_type: 'inode/directory', result_type: 'folder'
                }));
            }
            if (filesRes.data.success) merged = [...merged, ...filesRes.data.files];

            // Client-side sort to unify folders and files
            merged.sort((a, b) => {
                if (sortCol === 'created_at') {
                    const timeA = new Date(a.created_at || 0).getTime();
                    const timeB = new Date(b.created_at || 0).getTime();
                    return sortOrder === 'DESC' ? timeB - timeA : timeA - timeB;
                }
                if (sortCol === 'file_name') {
                    const nameA = (a.name || a.file_name || '').toLowerCase();
                    const nameB = (b.name || b.file_name || '').toLowerCase();
                    return sortOrder === 'DESC' ? nameB.localeCompare(nameA) : nameA.localeCompare(nameB);
                }
                if (sortCol === 'file_size') {
                    const sizeA = a.size || 0;
                    const sizeB = b.size || 0;
                    return sortOrder === 'DESC' ? sizeB - sizeA : sizeA - sizeB;
                }
                return 0;
            });

            setFiles(merged);
        } catch (e) {
            setLoadError('Could not load folder contents.');
            showToast('Could not load folder contents', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const filteredFiles = files.filter(item => {
        const matchesTab = filterTab === 'all' || (filterTab === 'folder' && (item.result_type === 'folder' || item.mime_type === 'inode/directory')) || item.mime_type?.includes(filterTab);
        const matchesSearch = !searchQuery.trim() || (item.name || item.file_name || '').toLowerCase().includes(searchQuery.toLowerCase());
        return matchesTab && matchesSearch;
    });

    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };

    const handleBulkAction = async (action: 'trash' | 'star' | 'move') => {
        const ids = Array.from(selectedIds).filter(id => {
            const item = files.find(f => f.id === id);
            return item && item.result_type !== 'folder';
        });
        if (ids.length === 0) { setSelectMode(false); setSelectedIds(new Set()); return; }

        try {
            if (action === 'trash') {
                await apiClient.post('/files/bulk', { ids, action: 'trash' });
                fetchFolderFiles();
            } else if (action === 'star') {
                await apiClient.post('/files/bulk', { ids, action: 'star' });
                fetchFolderFiles();
            } else if (action === 'move') {
                // Fetch all root-level folders so the Move modal is populated
                try {
                    const fRes = await apiClient.get('/files/folders');
                    if (fRes.data.success) setAllFolders(fRes.data.folders || []);
                } catch { /* non-critical — modal still opens with empty list */ }
                setMoveTarget({ ids });
                setMoveModalVisible(true);
                return; // don't reset select mode yet
            }
        } catch (e) { Alert.alert('Error', 'Bulk action failed'); }
        finally { setSelectMode(false); setSelectedIds(new Set()); }
    };

    const handleBulkMove = async (targetFolderId: string | null) => {
        if (!moveTarget?.ids) return;
        try {
            await apiClient.post('/files/bulk', { ids: moveTarget.ids, action: 'move', folder_id: targetFolderId });
            setMoveModalVisible(false);
            setMoveTarget(null);
            setSelectMode(false);
            setSelectedIds(new Set());
            fetchFolderFiles();
        } catch (e) { Alert.alert('Error', 'Could not move files'); }
    };

    const handleDelete = async (item: any) => {
        const isFolder = item.result_type === 'folder' || item.mime_type === 'inode/directory';
        const name = item.name || item.file_name;
        Alert.alert(
            isFolder ? 'Move Folder to Trash' : 'Move to Trash',
            isFolder
                ? `Move "${name}" and all its contents to trash?`
                : `Move "${name}" to trash?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Move to Trash',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            if (isFolder) {
                                await apiClient.delete(`/files/folder/${item.id}`);
                            } else {
                                await apiClient.patch(`/files/${item.id}/trash`);
                            }
                            fetchFolderFiles();
                        } catch (e: any) {
                            Alert.alert('Error', e.response?.data?.error || 'Could not move to trash');
                        }
                    }
                }
            ]
        );
    };

    // -- Delete current folder --------------------------------------------
    const handleDeleteCurrentFolder = () => {
        Alert.alert(
            'Move Folder to Trash',
            `Move "${folderName}" and all its contents to trash?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Move to Trash',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await apiClient.delete(`/files/folder/${folderId}`);
                            navigation.goBack();
                        } catch (e: any) {
                            Alert.alert('Error', e.response?.data?.error || 'Could not delete folder');
                        }
                    }
                }
            ]
        );
    };

    const handleLoadMore = useCallback(() => {
        setDisplayLimit(prev => prev + PAGE_SIZE);
    }, []);


    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) return;
        try {
            await apiClient.post('/files/folder', { name: newFolderName.trim(), parent_id: folderId, color: folderColor });
            setNewFolderName(''); setCreateModalVisible(false); fetchFolderFiles();
        } catch (e: any) { Alert.alert('Error', e.response?.data?.error || 'Failed'); }
    };

    const handleRename = async () => {
        if (!renameValue.trim() || !renameTarget) return;
        try {
            const endpoint = renameTarget.result_type === 'folder' ? `/files/folder/${renameTarget.id}` : `/files/${renameTarget.id}`;
            await apiClient.patch(endpoint, { name: renameValue.trim(), file_name: renameValue.trim() });
            setRenameTarget(null); setRenameModalVisible(false); fetchFolderFiles();
        } catch (e: any) { Alert.alert('Error', e.response?.data?.error || 'Failed'); }
    };

    const openInfoSheet = async (item: any) => {
        setInfoFile(item);
        try {
            // Tags always available
            const tagsRes = await apiClient.get(`/files/${item.id}/tags`).catch(() => ({ data: { tags: [] } }));
            setInfoTags(tagsRes.data.tags || []);

            // Share link comes from the modern share API response payload.
            if (item.result_type !== 'folder') {
                const shareRes = await apiClient.post('/api/v2/shares', { resource_type: 'file', root_file_id: item.id, expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() })
                    .catch(() => ({ data: { share_url: null, shareUrl: null } }));
                const link = String(shareRes.data?.share_url || shareRes.data?.shareUrl || '');
                setInfoShareLink(link || null);
            } else {
                setInfoShareLink(null); // Folders don't have share links
            }
        } catch {
            showToast('Could not load file info', 'error');
        }
    };

    const addTagToFile = async () => {
        if (!newTagInput.trim() || !infoFile) return;
        try {
            await apiClient.post(`/files/${infoFile.id}/tags`, { tag: newTagInput.trim() });
            setNewTagInput('');
            const res = await apiClient.get(`/files/${infoFile.id}/tags`);
            setInfoTags(res.data.tags || []);
        } catch {
            showToast('Could not add tag', 'error');
        }
    };

    const removeTagFromFile = async (tag: string) => {
        if (!infoFile) return;
        try {
            await apiClient.delete(`/files/${infoFile.id}/tags/${tag}`);
            const res = await apiClient.get(`/files/${infoFile.id}/tags`);
            setInfoTags(res.data.tags || []);
        } catch {
            showToast('Could not remove tag', 'error');
        }
    };

    const handleUploadInit = async () => {
        try {
            const res = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
            if (res.canceled) return;
            const fileAssets = res.assets.map(a => ({
                uri: a.uri,
                name: a.name,
                size: a.size ?? 0,
                mimeType: a.mimeType ?? 'application/octet-stream',
            }));
            addUpload(fileAssets, folderId, 'me');
        } catch { Alert.alert('Error', 'Pick failed'); }
    };

    const currentBreadcrumb = [...breadcrumb, { id: folderId, name: folderName }];

    const handleCardAction = useCallback((action: string, item: any) => {
        if (action === 'options') {
            setOptionsTarget(item);
        } else if (action === 'toggle' || action === 'longPress') {
            if (action === 'longPress' && !selectMode) setSelectMode(true);
            toggleSelect(item.id);
        } else if (action === 'openFolder') {
            navigation.push('FolderFiles', { folderId: item.id, folderName: item.name, breadcrumb: currentBreadcrumb });
        } else if (action === 'preview') {
            const now = Date.now();
            const last = lastAccessedRef.current.get(item.id) ?? 0;
            if (now - last > 5 * 60 * 1000) {
                lastAccessedRef.current.set(item.id, now);
                apiClient.post(`/files/${item.id}/accessed`).catch(() => { });
            }
            const previewableFiles = filteredFiles.filter(f => f.mime_type !== 'inode/directory');
            const idx = previewableFiles.findIndex(f => f.id === item.id);
            navigation.navigate('FilePreview', { files: previewableFiles, initialIndex: idx === -1 ? 0 : idx });
        } else if (action === 'rename') {
            setRenameTarget(item); setRenameValue(item.name || item.file_name); setRenameModalVisible(true);
        } else if (action === 'info') {
            openInfoSheet(item);
        } else if (action === 'shareLink') {
            setShareTarget(item);
            setShareModalVisible(true);
        } else if (action === 'star') {
            apiClient.patch(`/files/${item.id}/star`).then(fetchFolderFiles).catch(() => Alert.alert('Error', 'Could not update star'));
        } else if (action === 'move') {
            apiClient.get('/files/folders').then((res: any) => {
                if (res.data.success) {
                    setAllFolders(res.data.folders);
                    setMoveTarget({ ids: [item.id] });
                    setMoveModalVisible(true);
                }
            }).catch(() => Alert.alert('Error', 'Could not load folders'));
        } else if (action === 'trash') {
            handleDelete(item);
        }
    }, [selectMode, navigation, toggleSelect, currentBreadcrumb, filteredFiles, fetchFolderFiles]);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={[styles.header, { backgroundColor: theme.colors.background }]}>
                <TouchableOpacity style={styles.iconBtn} onPress={() => { if (selectMode) { setSelectMode(false); setSelectedIds(new Set()); } else navigation.goBack(); }}>
                    {selectMode ? <X color={theme.colors.textHeading} size={22} /> : <ArrowLeft color={theme.colors.textHeading} size={24} />}
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <Text style={[styles.headerTitle, { color: theme.colors.textHeading }]} numberOfLines={1}>{selectMode ? `${selectedIds.size} selected` : folderName}</Text>
                </View>

                <View style={styles.headerActions}>
                    {selectMode ? (
                        <>
                            <TouchableOpacity style={styles.iconBtn} onPress={() => handleBulkAction('star')}><Star color={theme.colors.accent} size={20} /></TouchableOpacity>
                            <TouchableOpacity style={styles.iconBtn} onPress={() => handleBulkAction('move')}><Move color={theme.colors.primary} size={20} /></TouchableOpacity>
                            <TouchableOpacity style={styles.iconBtn} onPress={() => handleBulkAction('trash')}><Trash2 color={theme.colors.danger} size={20} /></TouchableOpacity>
                        </>
                    ) : (
                        <>
                            <TouchableOpacity style={styles.iconBtn} onPress={() => setIsGridView(v => !v)}>{isGridView ? <List color={theme.colors.textHeading} size={20} /> : <Grid color={theme.colors.textHeading} size={20} />}</TouchableOpacity>
                            <TouchableOpacity style={styles.iconBtn} onPress={() => setShowSortModal(true)}><SortAsc color={theme.colors.textHeading} size={20} /></TouchableOpacity>
                            <TouchableOpacity style={styles.iconBtn} onPress={() => setCreateModalVisible(true)}><Plus color={theme.colors.textHeading} size={22} /></TouchableOpacity>
                            <TouchableOpacity style={styles.iconBtn} onPress={handleDeleteCurrentFolder}><Trash2 color={theme.colors.danger} size={20} /></TouchableOpacity>
                        </>
                    )}
                </View>
            </View>

            {breadcrumb.length > 0 && (
                <View style={styles.breadcrumbBar}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 20 }}>
                        <TouchableOpacity onPress={() => navigation.navigate('MainTabs', { screen: 'Home' })}><Text style={styles.crumbLink}>Home</Text></TouchableOpacity>
                        {breadcrumb.map((b, i) => (
                            <React.Fragment key={b.id}>
                                <Text style={styles.crumbSep}> › </Text>
                                <TouchableOpacity onPress={() => navigation.push('FolderFiles', { folderId: b.id, folderName: b.name, breadcrumb: breadcrumb.slice(0, i) })}>
                                    <Text style={styles.crumbLink}>{b.name}</Text>
                                </TouchableOpacity>
                            </React.Fragment>
                        ))}
                    </ScrollView>
                </View>
            )}

            <View style={{ backgroundColor: '#fff', paddingBottom: 10 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 20, alignItems: 'center' }}>
                    {FILTER_TABS.map(t => (
                        <TouchableOpacity key={t.key} style={[styles.tab, filterTab === t.key && styles.tabActive]} onPress={() => setFilterTab(t.key)}>
                            <View style={styles.tabInner}>
                                {t.Icon ? (
                                    <t.Icon color={filterTab === t.key ? '#fff' : staticTheme.colors.textBody} size={14} />
                                ) : null}
                                <Text style={[styles.tabText, filterTab === t.key && styles.tabTextActive]}>{t.label}</Text>
                            </View>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
                <View style={{ paddingHorizontal: 20 }}>
                    <View style={styles.searchContainer}>
                        <Search color={theme.colors.textBody} size={18} />
                        <TextInput style={styles.searchInput} placeholder={`Search in ${folderName}...`} value={searchQuery} onChangeText={setSearchQuery} />
                        {searchQuery ? <TouchableOpacity onPress={() => setSearchQuery('')}><X color={theme.colors.textBody} size={18} /></TouchableOpacity> : null}
                    </View>
                </View>
            </View>

            {/* ? FlatList with client-side pagination — loads PAGE_SIZE at a time */}
            <FlatList
                style={styles.scrollArea}
                data={isLoading ? [] : filteredFiles.slice(0, displayLimit)}
                keyExtractor={(item) => String(item.id)}
                renderItem={({ item }) => (
                    <MemoizedFileItem
                        item={item}
                        isSelected={selectedIds.has(item.id)}
                        isGridView={isGridView}
                        selectMode={selectMode}
                        theme={theme}
                        token={token}
                        onAction={handleCardAction}
                    />
                )}
                numColumns={isGridView ? 2 : 1}
                key={isGridView ? 'grid' : 'list'}
                columnWrapperStyle={isGridView ? styles.gridContainer : undefined}
                contentContainerStyle={{ paddingBottom: 100, marginTop: isGridView ? 12 : 0 }}
                showsVerticalScrollIndicator={false}
                windowSize={10}
                maxToRenderPerBatch={20}
                initialNumToRender={15}
                onEndReached={handleLoadMore}
                onEndReachedThreshold={0.5}
                ListFooterComponent={
                    !isLoading && filteredFiles.length > displayLimit ? (
                        <View style={{ paddingVertical: 20, alignItems: 'center' }}>
                            <ActivityIndicator size="small" color={staticTheme.colors.primary} />
                            <Text style={{ fontSize: 12, color: staticTheme.colors.textBody, marginTop: 8 }}>
                                Showing {Math.min(displayLimit, filteredFiles.length)} of {filteredFiles.length}
                            </Text>
                        </View>
                    ) : null
                }
                ListEmptyComponent={
                    isLoading ? (
                        <View style={{ paddingTop: 12 }}>
                            {[1, 2, 3, 4].map(i => <FileCardSkeleton key={i} />)}
                        </View>
                    ) : loadError ? (
                        <ErrorState
                            title="Could not load folder"
                            message={loadError}
                            onRetry={() => void fetchFolderFiles()}
                            style={{ paddingVertical: 60, flex: 0 }}
                        />
                    ) : (
                        <EmptyState
                            title={searchQuery ? 'No results found' : 'Folder is empty'}
                            description={searchQuery ? 'Try a different keyword' : 'Upload files or create subfolders here'}
                            iconType={searchQuery ? 'search' : 'folder'}
                            style={{ paddingVertical: 60, flex: 0 }}
                        />
                    )
                }
            />

            {!selectMode && (
                <TouchableOpacity style={styles.fab} onPress={handleUploadInit}>
                    <Plus color="#fff" size={32} />
                </TouchableOpacity>
            )}


            <Modal visible={isCreateModalVisible} transparent animationType="fade">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.centeredModal}>
                    <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>New Folder</Text>
                        <TextInput style={styles.modalInput} placeholder="Folder name" value={newFolderName} onChangeText={setNewFolderName} autoFocus />
                        <View style={styles.modalActions}>
                            <TouchableOpacity style={styles.modalBtn} onPress={() => setCreateModalVisible(false)}><Text style={styles.modalBtnText}>Cancel</Text></TouchableOpacity>
                            <TouchableOpacity style={[styles.modalBtn, { backgroundColor: theme.colors.primary }]} onPress={handleCreateFolder}><Text style={[styles.modalBtnText, { color: '#fff' }]}>Create</Text></TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* -- Move Files Modal -------------------------------------- */}
            <Modal visible={isMoveModalVisible} transparent animationType="slide">
                <TouchableOpacity
                    style={[styles.centeredModal, { justifyContent: 'flex-end', padding: 0 }]}
                    activeOpacity={1}
                    onPress={() => { setMoveModalVisible(false); setMoveTarget(null); setSelectMode(false); setSelectedIds(new Set()); }}
                >
                    <View style={[styles.modalCard, { borderRadius: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 }]}>
                        <View style={{ width: 40, height: 4, backgroundColor: theme.colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 }} />
                        <Text style={[styles.modalTitle, { marginBottom: 4 }]}>Move {moveTarget?.ids?.length || 0} file(s) to...</Text>
                        <Text style={[styles.modalSub, { marginBottom: 20 }]}>Choose a destination folder</Text>

                        {/* Root option */}
                        <TouchableOpacity
                            style={[styles.modalBtn, { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10, paddingHorizontal: 16, width: '100%' }]}
                            onPress={() => handleBulkMove(null)}
                        >
                            <Folder color={theme.colors.primary} size={20} />
                            <Text style={[styles.modalBtnText, { color: theme.colors.textHeading }]}>Home (Root)</Text>
                        </TouchableOpacity>

                        {allFolders.filter(f => f.id !== folderId).map(f => (
                            <TouchableOpacity
                                key={f.id}
                                style={[styles.modalBtn, { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10, paddingHorizontal: 16, width: '100%' }]}
                                onPress={() => handleBulkMove(f.id)}
                            >
                                <Folder color="#D97706" size={20} />
                                <Text style={[styles.modalBtnText, { color: theme.colors.textHeading }]}>{f.name}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* -- Rename Modal -------------------------------------- */}
            <Modal visible={isRenameModalVisible} transparent animationType="fade">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.centeredModal}>
                    <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>Rename</Text>
                        <TextInput
                            style={styles.modalInput}
                            placeholder="New name"
                            value={renameValue}
                            onChangeText={setRenameValue}
                            autoFocus
                            onSubmitEditing={handleRename}
                        />
                        <View style={styles.modalActions}>
                            <TouchableOpacity style={styles.modalBtn} onPress={() => { setRenameModalVisible(false); setRenameTarget(null); }}>
                                <Text style={styles.modalBtnText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.modalBtn, { backgroundColor: staticTheme.colors.primary }]} onPress={handleRename}>
                                <Text style={[styles.modalBtnText, { color: '#fff' }]}>Rename</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* -- Sort Modal --------------------------------------- */}
            <Modal visible={showSortModal} transparent animationType="slide">
                <TouchableOpacity
                    style={[styles.centeredModal, { justifyContent: 'flex-end', padding: 0 }]}
                    activeOpacity={1}
                    onPress={() => setShowSortModal(false)}
                >
                    <View style={[styles.modalCard, { borderRadius: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 }]}>
                        <View style={{ width: 36, height: 4, backgroundColor: staticTheme.colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />
                        <Text style={[styles.modalTitle, { marginBottom: 12 }]}>Sort by</Text>
                        {SORT_OPTIONS.map(opt => (
                            <TouchableOpacity
                                key={opt.key}
                                style={{
                                    flexDirection: 'row', alignItems: 'center', gap: 12,
                                    paddingVertical: 14, paddingHorizontal: 12,
                                    borderRadius: 12, marginBottom: 4,
                                    backgroundColor: sortKey === opt.key ? staticTheme.colors.primary + '18' : 'transparent',
                                }}
                                onPress={() => { setSortKey(opt.key); setShowSortModal(false); }}
                            >
                                <Text style={{
                                    flex: 1, fontSize: 15,
                                    color: sortKey === opt.key ? staticTheme.colors.primary : staticTheme.colors.textHeading,
                                    fontWeight: sortKey === opt.key ? '700' : '400',
                                }}>
                                    {opt.label}
                                </Text>
                                {sortKey === opt.key && (
                                    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: staticTheme.colors.primary, justifyContent: 'center', alignItems: 'center' }}>
                                        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>?</Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                        ))}
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* -- Options Modal --------------------------------------- */}
            <Modal visible={!!optionsTarget} transparent animationType="slide">
                <TouchableOpacity
                    style={[styles.centeredModal, { justifyContent: 'flex-end', padding: 0 }]}
                    activeOpacity={1}
                    onPress={() => setOptionsTarget(null)}
                >
                    <View style={[styles.modalCard, { borderRadius: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40 }]}>
                        <View style={{ width: 36, height: 4, backgroundColor: staticTheme.colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />
                        <Text style={[styles.modalTitle, { marginBottom: 12 }]}>{optionsTarget?.name || optionsTarget?.file_name}</Text>

                        <TouchableOpacity style={styles.optionItem} onPress={() => { setOptionsTarget(null); handleCardAction('shareLink', optionsTarget); }}>
                            <Share2 color={theme.colors.primary} size={20} />
                            <Text style={styles.optionText}>Share Link</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.optionItem} onPress={() => { setOptionsTarget(null); handleCardAction('rename', optionsTarget); }}>
                            <Tag color={theme.colors.accent} size={20} />
                            <Text style={styles.optionText}>Rename</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.optionItem} onPress={() => { setOptionsTarget(null); handleCardAction('info', optionsTarget); }}>
                            <Info color={theme.colors.primary} size={20} />
                            <Text style={styles.optionText}>Info & Tags</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.optionItem} onPress={() => { setOptionsTarget(null); handleCardAction('star', optionsTarget); }}>
                            <Star color={optionsTarget?.is_starred ? theme.colors.accent : theme.colors.textBody} size={20} />
                            <Text style={styles.optionText}>{optionsTarget?.is_starred ? 'Unstar' : 'Star'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.optionItem} onPress={() => { setOptionsTarget(null); handleCardAction('move', optionsTarget); }}>
                            <Move color={theme.colors.primary} size={20} />
                            <Text style={styles.optionText}>Move to Folder</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.optionItem, { backgroundColor: '#fee2e2' }]} onPress={() => { setOptionsTarget(null); handleCardAction('trash', optionsTarget); }}>
                            <Trash2 color={theme.colors.danger} size={20} />
                            <Text style={[styles.optionText, { color: theme.colors.danger }]}>Move to Trash</Text>
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* -- Share Folder Modal --------------------------------------- */}
            <ShareFolderModal
                visible={isShareModalVisible}
                onClose={closeShareModal}
                targetItem={shareTarget}
            />

        </SafeAreaView>
    );
}


const GRID_SIZE = (width - 48 - 12) / 2;
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: staticTheme.colors.background },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 8 },
    headerCenter: { flex: 1, alignItems: 'center' },
    headerTitle: { fontSize: 18, fontWeight: '700', color: staticTheme.colors.textHeading },
    headerActions: { flexDirection: 'row', gap: 4 },
    iconBtn: { padding: 8 },
    breadcrumbBar: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: staticTheme.colors.border, height: 40, justifyContent: 'center' },
    crumbLink: { fontSize: 12, color: staticTheme.colors.primary, fontWeight: '600' },
    crumbSep: { fontSize: 12, color: staticTheme.colors.textBody },
    tabBar: { height: 48 },
    tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: staticTheme.colors.background },
    tabActive: { backgroundColor: staticTheme.colors.primary },
    tabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tabText: { fontSize: 12, color: staticTheme.colors.textBody, fontWeight: '600' },
    tabTextActive: { color: '#fff' },
    scrollArea: { flex: 1, paddingHorizontal: 20 },
    emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
    emptyText: { color: staticTheme.colors.textBody, fontSize: 15, marginTop: 16 },
    fileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'transparent', paddingVertical: 12, paddingHorizontal: 0, marginBottom: 4 },
    fileCardSelected: { backgroundColor: 'rgba(75, 110, 245, 0.1)', borderRadius: 16, paddingHorizontal: 16 },
    fileDetails: { flex: 1 },
    fileName: { fontSize: 16, color: staticTheme.colors.textHeading, fontWeight: '600', marginBottom: 3 },
    fileMeta: { fontSize: 13, color: staticTheme.colors.textBody },
    moreBtn: { padding: 8, justifyContent: 'center', alignItems: 'center' },
    gridContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
    gridCard: { width: GRID_SIZE, borderRadius: 16, backgroundColor: '#fff', overflow: 'hidden', ...staticTheme.shadows.card },
    gridIcon: { width: '100%', height: GRID_SIZE * 0.75, justifyContent: 'center', alignItems: 'center' },
    gridLabel: { padding: 8 },
    gridName: { fontSize: 12, fontWeight: '600', color: staticTheme.colors.textHeading },
    gridCheckbox: { position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#fff', justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.3)' },
    fab: { position: 'absolute', bottom: 40, right: 24, width: 64, height: 64, borderRadius: 32, backgroundColor: staticTheme.colors.primary, justifyContent: 'center', alignItems: 'center', ...staticTheme.shadows.soft, elevation: 10, zIndex: 10 },
    centeredModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    modalCard: { width: '100%', backgroundColor: '#fff', borderRadius: 24, padding: 24, ...staticTheme.shadows.card },
    modalTitle: { fontSize: 20, fontWeight: '700', color: staticTheme.colors.textHeading, marginBottom: 16 },
    modalSub: { fontSize: 14, color: staticTheme.colors.textBody, marginBottom: 20 },
    modalInput: { width: '100%', height: 50, borderWidth: 1.5, borderColor: staticTheme.colors.border, borderRadius: 12, paddingHorizontal: 16, fontSize: 16, marginBottom: 20, color: staticTheme.colors.textHeading },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
    modalBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: '#f1f5f9' },
    modalBtnText: { color: staticTheme.colors.textHeading, fontWeight: '600', fontSize: 14 },
    searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 12, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: '#e2e8f0' },
    searchInput: { flex: 1, marginLeft: 10, fontSize: 15, color: staticTheme.colors.textHeading },
    optionItem: {
        flexDirection: 'row', alignItems: 'center', gap: 16,
        paddingVertical: 14, paddingHorizontal: 16,
        borderRadius: 16, backgroundColor: '#f8fafc', marginBottom: 8
    },
    optionText: { fontSize: 16, fontWeight: '600', color: staticTheme.colors.textHeading },
});

