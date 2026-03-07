import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, Dimensions, Alert, TextInput, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { MoreHorizontal, ArrowLeft, Folder as FolderIcon, Plus, SortAsc, SortDesc, Filter } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../services/apiClient';
import { theme } from '../ui/theme';
import { EmptyState } from '../ui/EmptyState';
import { FolderCardSkeleton } from '../ui/Skeleton';
import ShareFolderModal from '../components/ShareFolderModal';
import AppButton from '../components/AppButton';
import IconButton from '../components/IconButton';

const { width } = Dimensions.get('window');
const CARD_MARGIN = 12;
const CARD_WIDTH = (width - 48 - CARD_MARGIN) / 2;
const HOME_FOLDER_PREVIEW_LIMIT = 4;
const HOME_PINNED_FOLDERS_KEY = '@home_pinned_folder_ids_v1';

const FOLDER_COLORS = [
    '#4B6EF5', '#1fd45a', '#FCBD0B', '#EF4444', '#9333EA', '#0D9488'
];
const getFolderColor = (index: number) => FOLDER_COLORS[index % FOLDER_COLORS.length];
const asArray = <T,>(value: any): T[] => (Array.isArray(value) ? value : []);

// â”€â”€ Sort configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SORT_OPTIONS = [
    { key: 'created_at_DESC', label: 'Newest First', icon: SortDesc, col: 'created_at', order: 'DESC' },
    { key: 'created_at_ASC', label: 'Oldest First', icon: SortAsc, col: 'created_at', order: 'ASC' },
    { key: 'name_ASC', label: 'Name A-Z', icon: SortAsc, col: 'name', order: 'ASC' },
    { key: 'name_DESC', label: 'Name Z-A', icon: SortDesc, col: 'name', order: 'DESC' },
    { key: 'file_count_DESC', label: 'Most Files', icon: SortDesc, col: 'file_count', order: 'DESC' },
    { key: 'file_count_ASC', label: 'Fewest Files', icon: SortAsc, col: 'file_count', order: 'ASC' },
];

export default function FoldersScreen({ navigation }: any) {
    const [isLoading, setIsLoading] = useState(true);
    const [folders, setFolders] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');

    // Sort state
    const [sortKey, setSortKey] = useState('created_at_DESC');
    const [showSortModal, setShowSortModal] = useState(false);

    // Create
    const [isCreateModalVisible, setCreateModalVisible] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);

    // Rename
    const [isRenameModalVisible, setRenameModalVisible] = useState(false);
    const [renameTarget, setRenameTarget] = useState<any>(null);
    const [renameValue, setRenameValue] = useState('');
    const [isRenamingFolder, setIsRenamingFolder] = useState(false);
    const [pinnedFolderIds, setPinnedFolderIds] = useState<string[]>([]);

    // Share Folder
    const [shareModalVisible, setShareModalVisible] = useState(false);
    const [shareTarget, setShareTarget] = useState<any>(null);
    const closeShareModal = () => {
        setShareModalVisible(false);
        setTimeout(() => setShareTarget(null), 220);
    };

    // Options Modal
    const [optionsTarget, setOptionsTarget] = useState<any>(null);

    useEffect(() => { fetchFolders(); }, [sortKey]);
    useEffect(() => {
        const loadPinned = async () => {
            try {
                const raw = await AsyncStorage.getItem(HOME_PINNED_FOLDERS_KEY);
                if (!raw) {
                    setPinnedFolderIds([]);
                    return;
                }
                const parsed = JSON.parse(raw);
                setPinnedFolderIds(Array.isArray(parsed) ? parsed.map((id: any) => String(id)) : []);
            } catch {
                setPinnedFolderIds([]);
            }
        };
        void loadPinned();
    }, []);

    const fetchFolders = async () => {
        setIsLoading(true);
        try {
            const sortOpt = SORT_OPTIONS.find(s => s.key === sortKey) ?? SORT_OPTIONS[0];
            const res = await apiClient.get(`/files/folders?sort=${sortOpt.col}&order=${sortOpt.order}`);
            if (res.data.success) {
                const safeFolders = asArray(res.data.folders);
                setFolders(safeFolders.map((f: any, i: number) => ({
                    ...f,
                    color: getFolderColor(i),
                })));
            }
        } catch {
            Alert.alert('Error', 'Could not load folders.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateFolder = async () => {
        if (!newFolderName.trim() || isCreatingFolder) return;
        setIsCreatingFolder(true);
        try {
            const res = await apiClient.post('/files/folder', { name: newFolderName.trim() });
            if (res.data.success) {
                setNewFolderName('');
                setCreateModalVisible(false);
                fetchFolders();
            }
        } catch (e: any) {
            Alert.alert('Error', e.response?.data?.error || 'Could not create folder');
        } finally {
            setIsCreatingFolder(false);
        }
    };

    const handleRenameFolder = async () => {
        if (!renameValue.trim() || !renameTarget || isRenamingFolder) return;
        setIsRenamingFolder(true);
        try {
            const res = await apiClient.patch(`/files/folder/${renameTarget.id}`, { name: renameValue.trim() });
            if (res.data.success) {
                setRenameModalVisible(false);
                setRenameTarget(null);
                fetchFolders();
            }
        } catch (e: any) {
            Alert.alert('Error', e.response?.data?.error || 'Could not rename folder');
        } finally {
            setIsRenamingFolder(false);
        }
    };

    const persistPinnedFolders = async (ids: string[]) => {
        setPinnedFolderIds(ids);
        try {
            await AsyncStorage.setItem(HOME_PINNED_FOLDERS_KEY, JSON.stringify(ids));
        } catch {
            Alert.alert('Error', 'Could not save Home folder selection');
        }
    };

    const togglePinnedOnHome = async (folder: any) => {
        const folderId = String(folder?.id ?? '');
        if (!folderId) return;
        if (pinnedFolderIds.includes(folderId)) {
            await persistPinnedFolders(pinnedFolderIds.filter(id => id !== folderId));
            return;
        }
        if (pinnedFolderIds.length >= HOME_FOLDER_PREVIEW_LIMIT) {
            Alert.alert('Limit reached', `You can pin up to ${HOME_FOLDER_PREVIEW_LIMIT} folders on Home.`);
            return;
        }
        await persistPinnedFolders([...pinnedFolderIds, folderId]);
    };

    const openFolderMenu = (folder: any) => {
        if (Platform.OS === 'web') {
            setOptionsTarget(folder);
        } else {
            Alert.alert(
                'Folder Options',
                `Manage "${folder.name}"`,
                [
                    { text: 'Cancel', style: 'cancel' },
                    {
                        text: pinnedFolderIds.includes(String(folder.id)) ? 'Remove from Home' : 'Pin to Home',
                        onPress: () => { void togglePinnedOnHome(folder); }
                    },
                    {
                        text: 'Share Folder',
                        onPress: () => {
                            setShareTarget({
                                id: folder.id,
                                name: folder.name,
                                result_type: 'folder',
                            });
                            setShareModalVisible(true);
                        }
                    },
                    {
                        text: 'Rename',
                        onPress: () => {
                            setRenameTarget(folder);
                            setRenameValue(folder.name);
                            setRenameModalVisible(true);
                        }
                    },
                    {
                        text: 'Delete Folder',
                        style: 'destructive',
                        onPress: () => {
                            Alert.alert('Confirm', `Move "${folder.name}" to trash?`, [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                    text: 'Delete',
                                    style: 'destructive',
                                    onPress: async () => {
                                        try {
                                            await apiClient.delete(`/files/folder/${folder.id}`);
                                            fetchFolders();
                                        } catch (e: any) {
                                            Alert.alert('Error', e.response?.data?.error || 'Could not delete');
                                        }
                                    }
                                }
                            ]);
                        }
                    }
                ]
            );
        }
    };

    const filtered = folders.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
    const currentSort = SORT_OPTIONS.find(s => s.key === sortKey) ?? SORT_OPTIONS[0];
    const handleBack = () => {
        if (navigation?.canGoBack?.()) {
            navigation.goBack();
            return;
        }
        navigation?.navigate?.('MainTabs', { screen: 'Home' });
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <IconButton
                    variant="ghost"
                    style={styles.backBtn}
                    onPress={handleBack}
                    icon={<ArrowLeft color={theme.colors.textHeading} size={24} />}
                />
                <View style={styles.headerActions}>
                    <TouchableOpacity
                        style={styles.sortBtn}
                        onPress={() => setShowSortModal(true)}
                    >
                        <Filter size={16} color={theme.colors.primary} />
                        <Text style={styles.sortBtnText} numberOfLines={1}>
                            {currentSort.label.split(' ').slice(0, 2).join(' ')}
                        </Text>
                    </TouchableOpacity>
                    <IconButton
                        variant="surface"
                        style={styles.addBtn}
                        onPress={() => setCreateModalVisible(true)}
                        icon={<Plus color={theme.colors.textHeading} size={22} />}
                    />
                </View>
            </View>

            <View style={styles.titleSection}>
                <Text style={styles.pageTitle}>Your <Text style={{ fontWeight: '700' }}>Folders</Text></Text>
                <Text style={styles.statsSubtitle}>{folders.length} folder{folders.length !== 1 ? 's' : ''} | {currentSort.label}</Text>
            </View>

            <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
                {isLoading ? (
                    <View style={styles.gridContainer}>
                        {[1, 2, 3, 4].map(i => <FolderCardSkeleton key={i} />)}
                    </View>
                ) : (
                    <View style={styles.gridContainer}>
                        <TouchableOpacity
                            style={[styles.folderCard, { backgroundColor: '#F8FAFC' }]}
                            activeOpacity={0.8}
                            onPress={() => navigation.navigate('Files')}
                        >
                            <View style={styles.cardHeader}>
                                <View style={[styles.iconBox, { backgroundColor: '#EEF1FD' }]}>
                                    <FolderIcon color={theme.colors.primary} size={24} fill={theme.colors.primary} />
                                </View>
                            </View>
                            <View style={styles.cardFooter}>
                                <Text style={styles.folderName} numberOfLines={1}>All Files</Text>
                                <Text style={styles.folderMeta}>Storage Root</Text>
                            </View>
                        </TouchableOpacity>

                        {filtered.map((folder) => (
                            <TouchableOpacity
                                key={folder.id}
                                style={styles.folderCard}
                                activeOpacity={0.8}
                                onPress={() => navigation.navigate('FolderFiles', { folderId: folder.id, folderName: folder.name })}
                            >
                                <View style={styles.cardHeader}>
                                    <View style={[styles.iconBox, { backgroundColor: folder.color + '22' }]}>
                                        <FolderIcon color={folder.color} size={24} fill={folder.color} />
                                    </View>
                                    <IconButton
                                        variant="ghost"
                                        style={{ zIndex: 10 }}
                                        onPress={(e: any) => {
                                            if (e && e.stopPropagation) e.stopPropagation();
                                            if (e && e.preventDefault) e.preventDefault();
                                            openFolderMenu(folder);
                                        }}
                                        icon={<MoreHorizontal color={folder.color} size={20} />}
                                    />
                                </View>
                                <View style={styles.cardFooter}>
                                    <Text style={styles.folderName} numberOfLines={1}>{folder.name}</Text>
                                    <Text style={styles.folderMeta}>
                                        {folder.file_count != null ? `${folder.file_count} file${folder.file_count !== 1 ? 's' : ''}` : 'Empty'}
                                    </Text>
                                </View>
                            </TouchableOpacity>
                        ))}
                        {filtered.length === 0 && (
                            <View style={{ width: '100%', paddingTop: 20 }}>
                                <EmptyState
                                    title={searchQuery ? 'No results found' : 'No folders here'}
                                    description={searchQuery ? 'Try a different folder name' : 'Create a folder to organize your files'}
                                    iconType={searchQuery ? 'search' : 'folder'}
                                />
                            </View>
                        )
                        }
                    </View >
                )}
                <View style={{ height: 120 }} />
            </ScrollView >

            {/* â”€â”€ Create Folder Modal â”€â”€ */}
            < Modal visible={isCreateModalVisible} transparent animationType="fade" >
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>New Folder</Text>
                        <TextInput
                            style={styles.modalInput}
                            placeholder="Folder name"
                            value={newFolderName}
                            onChangeText={setNewFolderName}
                            autoFocus
                            onSubmitEditing={handleCreateFolder}
                        />
                        <View style={styles.modalActions}>
                            <AppButton
                                label="Cancel"
                                variant="secondary"
                                onPress={() => { setCreateModalVisible(false); setNewFolderName(''); }}
                            />
                            <AppButton
                                label="Create"
                                onPress={handleCreateFolder}
                                loading={isCreatingFolder}
                                disabled={!newFolderName.trim() || isCreatingFolder}
                            />
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal >

            {/* â”€â”€ Rename Folder Modal â”€â”€ */}
            < Modal visible={isRenameModalVisible} transparent animationType="fade" >
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>Rename Folder</Text>
                        <TextInput
                            style={styles.modalInput}
                            placeholder="New folder name"
                            value={renameValue}
                            onChangeText={setRenameValue}
                            autoFocus
                            onSubmitEditing={handleRenameFolder}
                        />
                        <View style={styles.modalActions}>
                            <AppButton
                                label="Cancel"
                                variant="secondary"
                                onPress={() => { setRenameModalVisible(false); setRenameTarget(null); }}
                            />
                            <AppButton
                                label="Rename"
                                onPress={handleRenameFolder}
                                loading={isRenamingFolder}
                                disabled={!renameValue.trim() || isRenamingFolder}
                            />
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal >

            {/* â”€â”€ Sort Modal â”€â”€ */}
            < Modal visible={showSortModal} transparent animationType="slide" >
                <TouchableOpacity
                    style={styles.sortModalOverlay}
                    activeOpacity={1}
                    onPress={() => setShowSortModal(false)}
                >
                    <View style={styles.sortSheet}>
                        <View style={styles.sortHandle} />
                        <Text style={styles.sortSheetTitle}>Sort by</Text>
                        {SORT_OPTIONS.map(opt => {
                            const OptIcon = opt.icon;
                            return (
                                <TouchableOpacity
                                    key={opt.key}
                                    style={[styles.sortRow, sortKey === opt.key && { backgroundColor: theme.colors.primary + '18' }]}
                                    onPress={() => { setSortKey(opt.key); setShowSortModal(false); }}
                                >
                                    <OptIcon
                                        size={18}
                                        color={sortKey === opt.key ? theme.colors.primary : theme.colors.textBody}
                                    />
                                    <Text style={[
                                        styles.sortRowText,
                                        { color: sortKey === opt.key ? theme.colors.primary : theme.colors.textHeading },
                                        sortKey === opt.key && { fontWeight: '700' },
                                    ]}>
                                        {opt.label}
                                    </Text>
                                    {sortKey === opt.key && (
                                        <View style={[styles.sortCheck, { backgroundColor: theme.colors.primary }]}>
                                            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>âœ“</Text>
                                        </View>
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                        <View style={{ height: 24 }} />
                    </View>
                </TouchableOpacity>
            </Modal >

            {/* â”€â”€ Options Modal (Web Fallback) â”€â”€ */}
            <Modal visible={!!optionsTarget} transparent animationType="slide">
                <TouchableOpacity
                    style={styles.sortModalOverlay}
                    activeOpacity={1}
                    onPress={() => setOptionsTarget(null)}
                >
                    <View style={styles.sortSheet}>
                        <View style={styles.sortHandle} />
                        <Text style={styles.sortSheetTitle}>Manage "{optionsTarget?.name}"</Text>

                        <TouchableOpacity style={styles.sortRow} onPress={() => { setOptionsTarget(null); void togglePinnedOnHome(optionsTarget); }}>
                            <Text style={styles.sortRowText}>{pinnedFolderIds.includes(String(optionsTarget?.id)) ? 'Remove from Home' : 'Pin to Home'}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.sortRow} onPress={() => {
                            setOptionsTarget(null);
                            setShareTarget({ id: optionsTarget.id, name: optionsTarget.name, result_type: 'folder' });
                            setShareModalVisible(true);
                        }}>
                            <Text style={styles.sortRowText}>Share Folder</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.sortRow} onPress={() => { setOptionsTarget(null); setRenameTarget(optionsTarget); setRenameValue(optionsTarget.name); setRenameModalVisible(true); }}>
                            <Text style={styles.sortRowText}>Rename Folder</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={[styles.sortRow, { borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 16, marginTop: 12 }]} onPress={async () => {
                            const targetId = optionsTarget.id;
                            setOptionsTarget(null);
                            const ok = window.confirm(`Move "${optionsTarget?.name}" to trash?`);
                            if (ok) {
                                try {
                                    await apiClient.delete(`/files/folder/${targetId}`);
                                    fetchFolders();
                                } catch (e: any) {
                                    window.alert(e.response?.data?.error || 'Could not delete');
                                }
                            }
                        }}>
                            <Text style={[styles.sortRowText, { color: 'red', fontWeight: 'bold' }]}>Delete Folder</Text>
                        </TouchableOpacity>

                        <View style={{ height: 24 }} />
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* â”€â”€ Share Folder Modal â”€â”€ */}
            <ShareFolderModal
                visible={shareModalVisible}
                onClose={closeShareModal}
                targetItem={shareTarget}
            />
        </SafeAreaView >
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingTop: 20 },
    backBtn: { padding: 8, marginLeft: -8 },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    addBtn: { padding: 4 },
    sortBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        paddingHorizontal: 10, borderRadius: 20, height: 34,
        backgroundColor: theme.colors.background,
        maxWidth: 130,
    },
    sortBtnText: { fontSize: 12, fontWeight: '600', color: theme.colors.primary },

    titleSection: { paddingHorizontal: 24, marginTop: 24, marginBottom: 24 },
    pageTitle: { fontSize: 30, fontWeight: '400', color: theme.colors.textHeading, letterSpacing: -0.5, marginBottom: 6 },
    statsSubtitle: { fontSize: 13, color: theme.colors.textBody },

    scrollArea: { flex: 1, paddingHorizontal: 24 },
    gridContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    emptyText: { width: '100%', textAlign: 'center', marginTop: 40, color: theme.colors.textBody, fontSize: 14 },

    folderCard: {
        width: CARD_WIDTH,
        backgroundColor: '#fff',
        borderRadius: 24,
        padding: 16,
        marginBottom: CARD_MARGIN,
        ...theme.shadows.card,
        elevation: 4,
        minHeight: 140,
        justifyContent: 'space-between'
    },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    iconBox: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    cardFooter: { marginTop: 20 },
    folderName: { fontSize: 15, fontWeight: '700', color: theme.colors.textHeading, marginBottom: 4 },
    folderMeta: { fontSize: 11, color: theme.colors.textBody, fontWeight: '500' },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    modalCard: { width: '100%', backgroundColor: '#fff', borderRadius: 24, padding: 24, ...theme.shadows.card },
    modalTitle: { fontSize: 20, fontWeight: '700', color: theme.colors.textHeading, marginBottom: 16 },
    modalInput: { width: '100%', height: 50, borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 16, fontSize: 16, marginBottom: 20, color: theme.colors.textHeading },
    modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
    modalBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, backgroundColor: '#f1f5f9' },
    modalBtnText: { color: theme.colors.textHeading, fontWeight: '600', fontSize: 14 },

    // Sort modal
    sortModalOverlay: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
        justifyContent: 'flex-end',
    },
    sortSheet: {
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        paddingHorizontal: 20, paddingTop: 12,
        backgroundColor: '#fff',
    },
    sortHandle: {
        width: 36, height: 4, borderRadius: 2,
        alignSelf: 'center', marginBottom: 16,
        backgroundColor: theme.colors.border,
    },
    sortSheetTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12, color: theme.colors.textHeading },
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

