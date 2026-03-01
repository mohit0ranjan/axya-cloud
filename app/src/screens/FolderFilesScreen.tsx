import React, { useState, useEffect, useContext, useCallback } from 'react';
import {
    View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView,
    ActivityIndicator, Alert, Platform, Modal, TextInput, KeyboardAvoidingView,
    Dimensions, FlatList, Animated,
} from 'react-native';
import {
    ArrowLeft, Trash2, FileText, Image as ImageIcon, Plus, Folder,
    MoreHorizontal, Star, Grid, List, Info, Move, Tag, CheckSquare, Square,
    SortAsc, SortDesc, Filter, X, Check, Share2, ShieldCheck, Search
} from 'lucide-react-native';
import { Image } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import apiClient from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { theme } from '../ui/theme';

const { width } = Dimensions.get('window');

const FILTER_TABS = [
    { key: 'all', label: 'All' },
    { key: 'image', label: '📸 Images' },
    { key: 'video', label: '🎬 Videos' },
    { key: 'audio', label: '🎵 Audio' },
    { key: 'pdf', label: '📄 Docs' },
    { key: 'folder', label: '📁 Folders' },
];

const SORT_OPTIONS = [
    { key: 'created_at_DESC', label: 'Newest First' },
    { key: 'created_at_ASC', label: 'Oldest First' },
    { key: 'file_name_ASC', label: 'Name A→Z' },
    { key: 'file_name_DESC', label: 'Name Z→A' },
    { key: 'file_size_DESC', label: 'Largest First' },
    { key: 'file_size_ASC', label: 'Smallest First' },
];

const COLORS = ['#4B6EF5', '#1FD45A', '#FCBD0B', '#EF4444', '#9333EA', '#0D9488', '#F97316', '#EC4899'];

function formatSize(bytes: number) {
    if (!bytes) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
}

function getIconConfig(mime: string) {
    if (!mime || mime === 'inode/directory') return { color: theme.colors.primary, bg: '#EEF1FD', Icon: Folder };
    if (mime.includes('image')) return { color: '#F59E0B', bg: '#FEF3C7', Icon: ImageIcon };
    if (mime.includes('video')) return { color: '#9333EA', bg: '#F3E8FF', Icon: FileText };
    if (mime.includes('audio')) return { color: '#1FD45A', bg: '#DCFCE7', Icon: FileText };
    if (mime.includes('pdf')) return { color: '#EF4444', bg: '#FEE2E2', Icon: FileText };
    if (mime.includes('zip')) return { color: '#F97316', bg: '#FFEDD5', Icon: FileText };
    return { color: theme.colors.primary, bg: '#EEF1FD', Icon: FileText };
}

export default function FolderFilesScreen({ route, navigation }: any) {
    const { folderId, folderName, breadcrumb = [] } = route.params;
    const { token } = useContext(AuthContext);

    // Core data
    const [isLoading, setIsLoading] = useState(true);
    const [files, setFiles] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');

    // View state
    const [filterTab, setFilterTab] = useState('all');
    const [sortKey, setSortKey] = useState('created_at_DESC');
    const [isGridView, setIsGridView] = useState(false);
    const [showSortModal, setShowSortModal] = useState(false);

    // Multi-select
    const [selectMode, setSelectMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Upload
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [totalUploadFiles, setTotalUploadFiles] = useState(0);
    const [currentUploadIndex, setCurrentUploadIndex] = useState(0);
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

    // Move modal
    const [isMoveModalVisible, setMoveModalVisible] = useState(false);
    const [allFolders, setAllFolders] = useState<any[]>([]);
    const [moveTarget, setMoveTarget] = useState<any>(null);

    useEffect(() => { fetchFolderFiles(); }, [folderId, sortKey]);

    const fetchFolderFiles = async () => {
        setIsLoading(true);
        try {
            const [sortCol, sortOrder] = sortKey.split('_').length === 3
                ? [sortKey.split('_')[0] + '_' + sortKey.split('_')[1], sortKey.split('_')[2]]
                : [sortKey.split('_')[0], sortKey.split('_')[1]];

            const [filesRes, foldersRes] = await Promise.all([
                apiClient.get(`/files?folder_id=${encodeURIComponent(folderId)}&sort=${sortCol}&order=${sortOrder}&limit=200`),
                apiClient.get(`/files/folders?parent_id=${encodeURIComponent(folderId)}`),
            ]);
            let merged: any[] = [];
            if (foldersRes.data.success) {
                merged = foldersRes.data.folders.map((f: any) => ({
                    ...f, name: f.name, mime_type: 'inode/directory', result_type: 'folder'
                }));
            }
            if (filesRes.data.success) merged = [...merged, ...filesRes.data.files];
            setFiles(merged);
        } catch (e) {
            console.error('Fetch failed', e);
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
            if (action === 'trash') await apiClient.post('/files/bulk', { ids, action: 'trash' });
            else if (action === 'star') await apiClient.post('/files/bulk', { ids, action: 'star' });
            else if (action === 'move') { setMoveTarget({ ids }); setMoveModalVisible(true); return; }
            fetchFolderFiles();
        } catch (e) { Alert.alert('Error', 'Bulk action failed'); }
        finally { setSelectMode(false); setSelectedIds(new Set()); }
    };

    const handleDelete = async (item: any) => {
        Alert.alert('Confirm', `Move ${item.name || item.file_name} to trash?`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    try {
                        const endpoint = item.result_type === 'folder' ? `/files/folder/${item.id}` : `/files/${item.id}`;
                        await apiClient.delete(endpoint);
                        fetchFolderFiles();
                    } catch (e) { Alert.alert('Error', 'Could not delete'); }
                }
            }
        ]);
    };

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
            const [tagsRes, shareRes] = await Promise.all([
                apiClient.get(`/files/${item.id}/tags`),
                apiClient.get(`/files/${item.id}/share`),
            ]);
            setInfoTags(tagsRes.data.tags || []);
            setInfoShareLink(shareRes.data.link);
        } catch { }
    };

    const addTagToFile = async () => {
        if (!newTagInput.trim() || !infoFile) return;
        try {
            await apiClient.post(`/files/${infoFile.id}/tags`, { tag: newTagInput.trim() });
            setNewTagInput('');
            const res = await apiClient.get(`/files/${infoFile.id}/tags`);
            setInfoTags(res.data.tags || []);
        } catch { }
    };

    const removeTagFromFile = async (tag: string) => {
        if (!infoFile) return;
        try {
            await apiClient.delete(`/files/${infoFile.id}/tags/${tag}`);
            const res = await apiClient.get(`/files/${infoFile.id}/tags`);
            setInfoTags(res.data.tags || []);
        } catch { }
    };

    const handleUploadInit = async () => {
        const res = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true });
        if (res.canceled) return;
        setTotalUploadFiles(res.assets.length);
        setCurrentUploadIndex(0);
        setIsUploading(true);
        handleUploadConfirm(res.assets);
    };

    const handleUploadConfirm = async (assets: any[]) => {
        for (let i = 0; i < assets.length; i++) {
            setCurrentUploadIndex(i + 1);
            setUploadProgress(0);
            const asset = assets[i];
            const formData = new FormData();
            formData.append('file', { uri: asset.uri, name: asset.name, type: asset.mimeType } as any);
            formData.append('folder_id', folderId || '');
            try {
                await apiClient.post('/files/upload', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                    onUploadProgress: (p) => setUploadProgress(Math.round((p.loaded * 100) / (p.total || 1))),
                });
            } catch (e) { console.error('Upload failed', e); }
        }
        setIsUploading(false); fetchFolderFiles();
    };

    const renderCard = (item: any) => {
        const isSelected = selectedIds.has(item.id);
        const isFolder = item.result_type === 'folder' || item.mime_type === 'inode/directory';
        const { color, bg, Icon } = getIconConfig(item.mime_type);
        const isMedia = item.mime_type?.includes('image') || item.mime_type?.includes('video');

        return (
            <TouchableOpacity
                key={item.id}
                style={[isGridView ? styles.gridCard : styles.fileCard, isSelected && styles.fileCardSelected]}
                onPress={() => {
                    if (selectMode) toggleSelect(item.id);
                    else if (isFolder) navigation.push('FolderFiles', { folderId: item.id, folderName: item.name, breadcrumb: currentBreadcrumb });
                    else navigation.navigate('FilePreview', { file: item });
                }}
                onLongPress={() => { if (!selectMode) { setSelectMode(true); toggleSelect(item.id); } }}
            >
                {isGridView ? (
                    <>
                        <View style={styles.gridIcon}>
                            {isMedia ? (
                                <Image
                                    source={{ uri: `${apiClient.defaults.baseURL}/files/${item.id}/thumbnail`, headers: { Authorization: `Bearer ${token}` } }}
                                    style={styles.gridImage}
                                    contentFit="cover" cachePolicy="disk"
                                />
                            ) : <Icon color={color} size={32} />}
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
                        <View style={[styles.fileIconBox, { backgroundColor: bg }]}>
                            {isMedia ? (
                                <Image
                                    source={{ uri: `${apiClient.defaults.baseURL}/files/${item.id}/thumbnail`, headers: { Authorization: `Bearer ${token}` } }}
                                    style={{ width: '100%', height: '100%', borderRadius: 12 }}
                                    contentFit="cover" cachePolicy="disk"
                                />
                            ) : <Icon color={color} size={22} />}
                        </View>
                        <View style={styles.fileDetails}>
                            <Text style={styles.fileName} numberOfLines={1}>{item.name || item.file_name}</Text>
                            <Text style={styles.fileMeta}>{isFolder ? 'Folder' : `${formatSize(item.size)} · ${new Date(item.created_at).toLocaleDateString()}`}</Text>
                        </View>
                        {!selectMode && (
                            <TouchableOpacity
                                hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                                onPress={() => {
                                    Alert.alert(item.name || item.file_name, 'Choose action', [
                                        { text: 'Cancel', style: 'cancel' },
                                        { text: '✏️ Rename', onPress: () => { setRenameTarget(item); setRenameValue(item.name || item.file_name); setRenameModalVisible(true); } },
                                        { text: 'ℹ️ Info & Tags', onPress: () => openInfoSheet(item) },
                                        { text: '⭐ Star', onPress: async () => { await apiClient.patch(`/files/${item.id}/star`); fetchFolderFiles(); } },
                                        { text: '🗑 Delete', style: 'destructive', onPress: () => handleDelete(item) },
                                    ]);
                                }}
                            >
                                <MoreHorizontal color={theme.colors.textBody} size={18} />
                            </TouchableOpacity>
                        )}
                    </>
                )}
            </TouchableOpacity>
        );
    };

    const currentBreadcrumb = [...breadcrumb, { id: folderId, name: folderName }];

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.iconBtn} onPress={() => { if (selectMode) { setSelectMode(false); setSelectedIds(new Set()); } else navigation.goBack(); }}>
                    {selectMode ? <X color={theme.colors.textHeading} size={22} /> : <ArrowLeft color={theme.colors.textHeading} size={24} />}
                </TouchableOpacity>
                <View style={styles.headerCenter}>
                    <Text style={styles.headerTitle} numberOfLines={1}>{selectMode ? `${selectedIds.size} selected` : folderName}</Text>
                </View>
                <View style={styles.headerActions}>
                    {selectMode ? (
                        <>
                            <TouchableOpacity style={styles.iconBtn} onPress={() => handleBulkAction('star')}><Star color={theme.colors.accent} size={20} /></TouchableOpacity>
                            <TouchableOpacity style={styles.iconBtn} onPress={() => handleBulkAction('trash')}><Trash2 color={theme.colors.danger} size={20} /></TouchableOpacity>
                        </>
                    ) : (
                        <>
                            <TouchableOpacity style={styles.iconBtn} onPress={() => setIsGridView(v => !v)}>{isGridView ? <List color={theme.colors.textHeading} size={20} /> : <Grid color={theme.colors.textHeading} size={20} />}</TouchableOpacity>
                            <TouchableOpacity style={styles.iconBtn} onPress={() => setShowSortModal(true)}><SortAsc color={theme.colors.textHeading} size={20} /></TouchableOpacity>
                            <TouchableOpacity style={styles.iconBtn} onPress={() => setCreateModalVisible(true)}><Plus color={theme.colors.textHeading} size={22} /></TouchableOpacity>
                        </>
                    )}
                </View>
            </View>

            {breadcrumb.length > 0 && (
                <View style={styles.breadcrumbBar}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 20 }}>
                        <TouchableOpacity onPress={() => navigation.navigate('Home')}><Text style={styles.crumbLink}>🏠 Home</Text></TouchableOpacity>
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
                            <Text style={[styles.tabText, filterTab === t.key && styles.tabTextActive]}>{t.label}</Text>
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

            <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
                {isLoading ? (
                    <ActivityIndicator style={{ marginTop: 40 }} size="large" color={theme.colors.primary} />
                ) : filteredFiles.length === 0 ? (
                    <View style={styles.emptyState}>
                        <Folder color="#cbd5e1" size={48} />
                        <Text style={styles.emptyText}>{searchQuery ? 'No results found' : 'Folder is empty'}</Text>
                    </View>
                ) : isGridView ? (
                    <View style={styles.gridContainer}>{filteredFiles.map(item => renderCard(item))}</View>
                ) : (
                    <View style={{ marginTop: 12 }}>{filteredFiles.map(item => renderCard(item))}</View>
                )}
                <View style={{ height: 100 }} />
            </ScrollView>

            {!selectMode && (
                <TouchableOpacity style={styles.fab} onPress={handleUploadInit}>
                    <Plus color="#fff" size={32} />
                </TouchableOpacity>
            )}

            {isUploading && (
                <View style={styles.centeredModal}>
                    <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>Uploading {currentUploadIndex}/{totalUploadFiles}</Text>
                        <View style={{ height: 10, backgroundColor: '#f1f5f9', borderRadius: 5, overflow: 'hidden', marginVertical: 20 }}>
                            <View style={{ width: `${uploadProgress}%`, height: '100%', backgroundColor: theme.colors.primary }} />
                        </View>
                        <Text style={styles.modalSub}>{uploadProgress}% completed</Text>
                    </View>
                </View>
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
        </SafeAreaView>
    );
}

const GRID_SIZE = (width - 48 - 12) / 2;
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 8 },
    headerCenter: { flex: 1, alignItems: 'center' },
    headerTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.textHeading },
    headerActions: { flexDirection: 'row', gap: 4 },
    iconBtn: { padding: 8 },
    breadcrumbBar: { backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: theme.colors.border, height: 40, justifyContent: 'center' },
    crumbLink: { fontSize: 12, color: theme.colors.primary, fontWeight: '600' },
    crumbSep: { fontSize: 12, color: theme.colors.textBody },
    tabBar: { height: 48 },
    tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: theme.colors.background },
    tabActive: { backgroundColor: theme.colors.primary },
    tabText: { fontSize: 12, color: theme.colors.textBody, fontWeight: '600' },
    tabTextActive: { color: '#fff' },
    scrollArea: { flex: 1, paddingHorizontal: 20 },
    emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
    emptyText: { color: theme.colors.textBody, fontSize: 15, marginTop: 16 },
    fileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 14, borderRadius: 18, marginBottom: 10, ...theme.shadows.card },
    fileCardSelected: { borderWidth: 2, borderColor: theme.colors.primary },
    fileIconBox: { width: 46, height: 46, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
    fileDetails: { flex: 1 },
    fileName: { fontSize: 15, color: theme.colors.textHeading, fontWeight: '600', marginBottom: 3 },
    fileMeta: { fontSize: 12, color: theme.colors.textBody },
    gridContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
    gridCard: { width: GRID_SIZE, borderRadius: 16, backgroundColor: '#fff', overflow: 'hidden', ...theme.shadows.card },
    gridImage: { width: '100%', height: GRID_SIZE * 0.75 },
    gridIcon: { width: '100%', height: GRID_SIZE * 0.75, justifyContent: 'center', alignItems: 'center' },
    gridLabel: { padding: 8 },
    gridName: { fontSize: 12, fontWeight: '600', color: theme.colors.textHeading },
    gridCheckbox: { position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#fff', justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.3)' },
    fab: { position: 'absolute', bottom: 40, right: 24, width: 64, height: 64, borderRadius: 32, backgroundColor: theme.colors.primary, justifyContent: 'center', alignItems: 'center', ...theme.shadows.soft, elevation: 10, zIndex: 10 },
    centeredModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    modalCard: { width: '100%', backgroundColor: '#fff', borderRadius: 24, padding: 24, ...theme.shadows.card },
    modalTitle: { fontSize: 20, fontWeight: '700', color: theme.colors.textHeading, marginBottom: 16 },
    modalSub: { fontSize: 14, color: theme.colors.textBody, marginBottom: 20 },
    modalInput: { width: '100%', height: 50, borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 16, fontSize: 16, marginBottom: 20, color: theme.colors.textHeading },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
    modalBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: '#f1f5f9' },
    modalBtnText: { color: theme.colors.textHeading, fontWeight: '600', fontSize: 14 },
    searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 12, paddingHorizontal: 12, height: 44, borderWidth: 1, borderColor: '#e2e8f0' },
    searchInput: { flex: 1, marginLeft: 10, fontSize: 15, color: theme.colors.textHeading },
});
