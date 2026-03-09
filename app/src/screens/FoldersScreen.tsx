import React, { useMemo, useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    SafeAreaView,
    Dimensions,
    Alert,
    TextInput,
    Modal,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import {
    MoreHorizontal,
    ArrowLeft,
    Folder as FolderIcon,
    Plus,
    SortAsc,
    SortDesc,
    Filter,
    Search,
    X,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../services/apiClient';
import { EmptyState } from '../ui/EmptyState';
import { FolderCardSkeleton } from '../ui/Skeleton';
import ShareFolderModal from '../components/ShareFolderModal';
import AppButton from '../components/AppButton';
import IconButton from '../components/IconButton';
import { formatFolderMeta } from '../utils/folderMeta';
import { useTheme } from '../context/ThemeContext';

const { width } = Dimensions.get('window');
const CARD_MARGIN = 12;
const CARD_WIDTH = (width - 48 - CARD_MARGIN) / 2;
const HOME_FOLDER_PREVIEW_LIMIT = 4;
const HOME_PINNED_FOLDERS_KEY = '@home_pinned_folder_ids_v1';

const FOLDER_COLORS = ['#4B6EF5', '#1FD45A', '#FCBD0B', '#EF4444', '#9333EA', '#0D9488'];
const getFolderColor = (index: number) => FOLDER_COLORS[index % FOLDER_COLORS.length];
const asArray = <T,>(value: any): T[] => (Array.isArray(value) ? value : []);

const SORT_OPTIONS = [
    { key: 'created_at_DESC', label: 'Newest First', icon: SortDesc, col: 'created_at', order: 'DESC' },
    { key: 'created_at_ASC', label: 'Oldest First', icon: SortAsc, col: 'created_at', order: 'ASC' },
    { key: 'name_ASC', label: 'Name A-Z', icon: SortAsc, col: 'name', order: 'ASC' },
    { key: 'name_DESC', label: 'Name Z-A', icon: SortDesc, col: 'name', order: 'DESC' },
    { key: 'file_count_DESC', label: 'Most Files', icon: SortDesc, col: 'file_count', order: 'DESC' },
    { key: 'file_count_ASC', label: 'Fewest Files', icon: SortAsc, col: 'file_count', order: 'ASC' },
];

const createStyles = (theme: any, C: any) =>
    StyleSheet.create({
        container: { flex: 1, backgroundColor: C.background },
        header: {
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            paddingHorizontal: 20,
            paddingTop: Platform.OS === 'web' ? 20 : 12,
            paddingBottom: 8,
        },
        backBtn: { width: 44, height: 44 },
        headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
        addBtn: { width: 44, height: 44 },
        sortBtn: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 12,
            borderRadius: 14,
            height: 44,
            backgroundColor: C.card,
            borderWidth: 1,
            borderColor: C.border,
            maxWidth: 160,
        },
        sortBtnText: { fontSize: 12, fontWeight: '600', color: C.primary },

        titleSection: { paddingHorizontal: 24, marginTop: 16, marginBottom: 14 },
        pageTitle: { fontSize: 30, fontWeight: '400', color: C.textHeading, letterSpacing: -0.5, marginBottom: 6 },
        statsSubtitle: { fontSize: 13, color: C.textBody },

        searchWrap: { paddingHorizontal: 24, marginBottom: 16 },
        searchBar: {
            height: 44,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: C.border,
            backgroundColor: C.card,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 12,
            gap: 8,
        },
        searchInput: { flex: 1, color: C.textHeading, fontSize: 14 },

        scrollArea: { flex: 1, paddingHorizontal: 24 },
        gridContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },

        folderCard: {
            width: CARD_WIDTH,
            backgroundColor: C.card,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: C.border,
            padding: 14,
            marginBottom: CARD_MARGIN,
            ...theme.shadows.elevation1,
            minHeight: 138,
            justifyContent: 'space-between',
        },
        cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
        iconBox: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
        cardFooter: { marginTop: 18 },
        folderName: { fontSize: 15, fontWeight: '700', color: C.textHeading, marginBottom: 6 },
        folderMeta: { fontSize: 12, color: C.textBody, fontWeight: '600' },
        moreBtn: { width: 40, height: 40 },

        modalOverlay: {
            flex: 1,
            backgroundColor: C.overlay,
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
        },
        modalCard: { width: '100%', backgroundColor: C.card, borderRadius: 24, padding: 24, ...theme.shadows.card },
        modalTitle: { fontSize: 20, fontWeight: '700', color: C.textHeading, marginBottom: 16 },
        modalInput: {
            width: '100%',
            height: 50,
            borderWidth: 1.5,
            borderColor: C.border,
            borderRadius: 12,
            paddingHorizontal: 16,
            fontSize: 16,
            marginBottom: 20,
            color: C.textHeading,
            backgroundColor: C.background,
        },
        modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },

        sortModalOverlay: {
            flex: 1,
            backgroundColor: C.overlay,
            justifyContent: 'flex-end',
        },
        sortSheet: {
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 20,
            paddingTop: 12,
            backgroundColor: C.card,
        },
        sortHandle: {
            width: 36,
            height: 4,
            borderRadius: 2,
            alignSelf: 'center',
            marginBottom: 16,
            backgroundColor: C.border,
        },
        sortSheetTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12, color: C.textHeading },
        sortRow: {
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingVertical: 14,
            paddingHorizontal: 12,
            borderRadius: 12,
            marginBottom: 4,
        },
        sortRowText: { flex: 1, fontSize: 15 },
        sortCheck: {
            width: 20,
            height: 20,
            borderRadius: 10,
            justifyContent: 'center',
            alignItems: 'center',
        },

        confirmTitle: { fontSize: 18, fontWeight: '700', color: C.textHeading, marginBottom: 6 },
        confirmSub: { fontSize: 14, color: C.textBody, marginBottom: 20 },
        confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
        dangerBtn: {
            height: 44,
            paddingHorizontal: 14,
            borderRadius: 12,
            backgroundColor: C.danger,
            justifyContent: 'center',
            alignItems: 'center',
        },
        dangerBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    });

export default function FoldersScreen({ navigation }: any) {
    const { theme } = useTheme();
    const C = theme.colors;
    const styles = useMemo(() => createStyles(theme, C), [theme, C]);

    const [isLoading, setIsLoading] = useState(true);
    const [folders, setFolders] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');

    const [sortKey, setSortKey] = useState('created_at_DESC');
    const [showSortModal, setShowSortModal] = useState(false);

    const [isCreateModalVisible, setCreateModalVisible] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);

    const [isRenameModalVisible, setRenameModalVisible] = useState(false);
    const [renameTarget, setRenameTarget] = useState<any>(null);
    const [renameValue, setRenameValue] = useState('');
    const [isRenamingFolder, setIsRenamingFolder] = useState(false);
    const [pinnedFolderIds, setPinnedFolderIds] = useState<string[]>([]);

    const [shareModalVisible, setShareModalVisible] = useState(false);
    const [shareTarget, setShareTarget] = useState<any>(null);
    const closeShareModal = () => {
        setShareModalVisible(false);
        setTimeout(() => setShareTarget(null), 220);
    };

    const [optionsTarget, setOptionsTarget] = useState<any>(null);
    const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<any>(null);
    const openFolder = (folder: any) => navigation.navigate('FolderFiles', { folderId: folder.id, folderName: folder.name });

    useEffect(() => {
        void fetchFolders();
    }, [sortKey]);

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
                setFolders(
                    safeFolders.map((f: any, i: number) => ({
                        ...f,
                        color: getFolderColor(i),
                    }))
                );
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
                await fetchFolders();
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
                await fetchFolders();
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

    const confirmDeleteFolder = async (folder: any) => {
        try {
            await apiClient.delete(`/files/folder/${folder.id}`);
            await fetchFolders();
        } catch (e: any) {
            Alert.alert('Error', e.response?.data?.error || 'Could not delete');
        }
    };

    const openFolderMenu = (folder: any) => {
        if (Platform.OS === 'web') {
            setOptionsTarget(folder);
            return;
        }

        Alert.alert('Folder Options', `Manage "${folder.name}"`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: pinnedFolderIds.includes(String(folder.id)) ? 'Remove from Home' : 'Pin to Home',
                onPress: () => {
                    void togglePinnedOnHome(folder);
                },
            },
            {
                text: 'Share Folder',
                onPress: () => {
                    setShareTarget({ id: folder.id, name: folder.name, result_type: 'folder' });
                    setShareModalVisible(true);
                },
            },
            {
                text: 'Rename',
                onPress: () => {
                    setRenameTarget(folder);
                    setRenameValue(folder.name);
                    setRenameModalVisible(true);
                },
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
                            onPress: () => {
                                void confirmDeleteFolder(folder);
                            },
                        },
                    ]);
                },
            },
        ]);
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
                    icon={<ArrowLeft color={C.textHeading} size={22} />}
                />
                <View style={styles.headerActions}>
                    <TouchableOpacity style={styles.sortBtn} onPress={() => setShowSortModal(true)}>
                        <Filter size={16} color={C.primary} />
                        <Text style={styles.sortBtnText} numberOfLines={1}>
                            {currentSort.label.split(' ').slice(0, 2).join(' ')}
                        </Text>
                    </TouchableOpacity>
                    <IconButton
                        variant="surface"
                        style={styles.addBtn}
                        onPress={() => setCreateModalVisible(true)}
                        icon={<Plus color={C.textHeading} size={22} />}
                    />
                </View>
            </View>

            <View style={styles.titleSection}>
                <Text style={styles.pageTitle}>
                    Your <Text style={{ fontWeight: '700' }}>Folders</Text>
                </Text>
                <Text style={styles.statsSubtitle}>
                    {folders.length} folder{folders.length !== 1 ? 's' : ''} | {currentSort.label}
                </Text>
            </View>

            <View style={styles.searchWrap}>
                <View style={styles.searchBar}>
                    <Search color={C.textBody} size={16} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search folders"
                        placeholderTextColor={C.textBody}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                    {!!searchQuery && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <X color={C.textBody} size={16} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
                {isLoading ? (
                    <View style={styles.gridContainer}>{[1, 2, 3, 4].map(i => <FolderCardSkeleton key={i} />)}</View>
                ) : (
                    <View style={styles.gridContainer}>
                        <TouchableOpacity
                            style={[styles.folderCard, { backgroundColor: C.primaryLight }]}
                            activeOpacity={0.8}
                            onPress={() => navigation.navigate('Files')}
                        >
                            <View style={styles.cardHeader}>
                                <View style={[styles.iconBox, { backgroundColor: C.card }]}>
                                    <FolderIcon color={C.primary} size={24} fill={C.primary} />
                                </View>
                            </View>
                            <View style={styles.cardFooter}>
                                <Text style={[styles.folderName, { color: C.primary }]} numberOfLines={1}>
                                    All Files
                                </Text>
                                <Text style={styles.folderMeta}>Storage Root</Text>
                            </View>
                        </TouchableOpacity>

                        {filtered.map(folder => (
                            <TouchableOpacity
                                key={folder.id}
                                style={styles.folderCard}
                                activeOpacity={0.88}
                                onPress={() => openFolder(folder)}
                            >
                                <View style={styles.cardHeader}>
                                    <View style={[styles.iconBox, { backgroundColor: `${folder.color}1A` }]}>
                                        <FolderIcon color={folder.color} size={24} fill={folder.color} />
                                    </View>
                                    <IconButton
                                        variant="ghost"
                                        style={styles.moreBtn}
                                        onPress={(e: any) => {
                                            e?.stopPropagation?.();
                                            e?.preventDefault?.();
                                            openFolderMenu(folder);
                                        }}
                                        icon={<MoreHorizontal color={folder.color} size={20} />}
                                    />
                                </View>
                                <View style={styles.cardFooter}>
                                    <Text style={styles.folderName} numberOfLines={1}>
                                        {folder.name}
                                    </Text>
                                    <Text style={styles.folderMeta}>{formatFolderMeta(folder)}</Text>
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
                        )}
                    </View>
                )}
                <View style={{ height: 120 }} />
            </ScrollView>

            <Modal visible={isCreateModalVisible} transparent animationType="fade">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>New Folder</Text>
                        <TextInput
                            style={styles.modalInput}
                            placeholder="Folder name"
                            placeholderTextColor={C.textBody}
                            value={newFolderName}
                            onChangeText={setNewFolderName}
                            autoFocus
                            onSubmitEditing={handleCreateFolder}
                        />
                        <View style={styles.modalActions}>
                            <AppButton label="Cancel" variant="secondary" onPress={() => { setCreateModalVisible(false); setNewFolderName(''); }} />
                            <AppButton label="Create" onPress={handleCreateFolder} loading={isCreatingFolder} disabled={!newFolderName.trim() || isCreatingFolder} />
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            <Modal visible={isRenameModalVisible} transparent animationType="fade">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>Rename Folder</Text>
                        <TextInput
                            style={styles.modalInput}
                            placeholder="New folder name"
                            placeholderTextColor={C.textBody}
                            value={renameValue}
                            onChangeText={setRenameValue}
                            autoFocus
                            onSubmitEditing={handleRenameFolder}
                        />
                        <View style={styles.modalActions}>
                            <AppButton label="Cancel" variant="secondary" onPress={() => { setRenameModalVisible(false); setRenameTarget(null); }} />
                            <AppButton label="Rename" onPress={handleRenameFolder} loading={isRenamingFolder} disabled={!renameValue.trim() || isRenamingFolder} />
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            <Modal visible={showSortModal} transparent animationType="slide">
                <TouchableOpacity style={styles.sortModalOverlay} activeOpacity={1} onPress={() => setShowSortModal(false)}>
                    <View style={styles.sortSheet}>
                        <View style={styles.sortHandle} />
                        <Text style={styles.sortSheetTitle}>Sort by</Text>
                        {SORT_OPTIONS.map(opt => {
                            const OptIcon = opt.icon;
                            return (
                                <TouchableOpacity
                                    key={opt.key}
                                    style={[styles.sortRow, sortKey === opt.key && { backgroundColor: `${C.primary}18` }]}
                                    onPress={() => {
                                        setSortKey(opt.key);
                                        setShowSortModal(false);
                                    }}
                                >
                                    <OptIcon size={18} color={sortKey === opt.key ? C.primary : C.textBody} />
                                    <Text style={[styles.sortRowText, { color: sortKey === opt.key ? C.primary : C.textHeading }, sortKey === opt.key && { fontWeight: '700' }]}>
                                        {opt.label}
                                    </Text>
                                    {sortKey === opt.key && (
                                        <View style={[styles.sortCheck, { backgroundColor: C.primary }]}>
                                            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>?</Text>
                                        </View>
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                        <View style={{ height: 24 }} />
                    </View>
                </TouchableOpacity>
            </Modal>

            <Modal visible={!!optionsTarget} transparent animationType="slide">
                <TouchableOpacity style={styles.sortModalOverlay} activeOpacity={1} onPress={() => setOptionsTarget(null)}>
                    <View style={styles.sortSheet}>
                        <View style={styles.sortHandle} />
                        <Text style={styles.sortSheetTitle}>Manage "{optionsTarget?.name}"</Text>

                        <TouchableOpacity style={styles.sortRow} onPress={() => { setOptionsTarget(null); void togglePinnedOnHome(optionsTarget); }}>
                            <Text style={[styles.sortRowText, { color: C.textHeading }]}>{pinnedFolderIds.includes(String(optionsTarget?.id)) ? 'Remove from Home' : 'Pin to Home'}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.sortRow}
                            onPress={() => {
                                setOptionsTarget(null);
                                setShareTarget({ id: optionsTarget.id, name: optionsTarget.name, result_type: 'folder' });
                                setShareModalVisible(true);
                            }}
                        >
                            <Text style={[styles.sortRowText, { color: C.textHeading }]}>Share Folder</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.sortRow}
                            onPress={() => {
                                setOptionsTarget(null);
                                setRenameTarget(optionsTarget);
                                setRenameValue(optionsTarget.name);
                                setRenameModalVisible(true);
                            }}
                        >
                            <Text style={[styles.sortRowText, { color: C.textHeading }]}>Rename Folder</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={[styles.sortRow, { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 16, marginTop: 12 }]}
                            onPress={() => {
                                setDeleteConfirmTarget(optionsTarget);
                                setOptionsTarget(null);
                            }}
                        >
                            <Text style={[styles.sortRowText, { color: C.danger, fontWeight: '700' }]}>Delete Folder</Text>
                        </TouchableOpacity>

                        <View style={{ height: 24 }} />
                    </View>
                </TouchableOpacity>
            </Modal>

            <Modal visible={!!deleteConfirmTarget} transparent animationType="fade">
                <View style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <Text style={styles.confirmTitle}>Delete Folder</Text>
                        <Text style={styles.confirmSub}>Move "{deleteConfirmTarget?.name}" to trash?</Text>
                        <View style={styles.confirmActions}>
                            <AppButton label="Cancel" variant="secondary" onPress={() => setDeleteConfirmTarget(null)} />
                            <TouchableOpacity
                                style={styles.dangerBtn}
                                onPress={async () => {
                                    const target = deleteConfirmTarget;
                                    setDeleteConfirmTarget(null);
                                    if (target) await confirmDeleteFolder(target);
                                }}
                            >
                                <Text style={styles.dangerBtnText}>Delete</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            <ShareFolderModal visible={shareModalVisible} onClose={closeShareModal} targetItem={shareTarget} />
        </SafeAreaView>
    );
}
