import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, SafeAreaView, Dimensions, ActivityIndicator, Alert, TextInput, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { MoreHorizontal, ArrowLeft, Folder as FolderIcon, Plus } from 'lucide-react-native';
import apiClient from '../services/apiClient';
import { theme } from '../ui/theme';

const { width } = Dimensions.get('window');
const CARD_MARGIN = 12;
const CARD_WIDTH = (width - 48 - CARD_MARGIN) / 2;

const FOLDER_COLORS = [
    '#4B6EF5', '#1fd45a', '#FCBD0B', '#EF4444', '#9333EA', '#0D9488'
];
const getFolderColor = (index: number) => FOLDER_COLORS[index % FOLDER_COLORS.length];

export default function FoldersScreen({ navigation }: any) {
    const [isLoading, setIsLoading] = useState(true);
    const [folders, setFolders] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');

    // Create
    const [isCreateModalVisible, setCreateModalVisible] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');

    // Rename
    const [isRenameModalVisible, setRenameModalVisible] = useState(false);
    const [renameTarget, setRenameTarget] = useState<any>(null);
    const [renameValue, setRenameValue] = useState('');

    useEffect(() => { fetchFolders(); }, []);

    const fetchFolders = async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get('/files/folders');
            if (res.data.success) {
                setFolders(res.data.folders.map((f: any, i: number) => ({
                    ...f,                              // ✅ preserve file_count + all API fields
                    color: getFolderColor(i),          // override color with our palette
                })));
            }
        } catch {
            Alert.alert('Error', 'Could not load folders.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) return;
        try {
            const res = await apiClient.post('/files/folder', { name: newFolderName.trim() });
            if (res.data.success) {
                setNewFolderName('');
                setCreateModalVisible(false);
                fetchFolders();
            }
        } catch (e: any) {
            Alert.alert('Error', e.response?.data?.error || 'Could not create folder');
        }
    };

    const handleRenameFolder = async () => {
        if (!renameValue.trim() || !renameTarget) return;
        try {
            const res = await apiClient.patch(`/files/folder/${renameTarget.id}`, { name: renameValue.trim() });
            if (res.data.success) {
                setRenameModalVisible(false);
                setRenameTarget(null);
                fetchFolders();
            }
        } catch (e: any) {
            Alert.alert('Error', e.response?.data?.error || 'Could not rename folder');
        }
    };

    const openFolderMenu = (folder: any) => {
        Alert.alert(
            'Folder Options',
            `Manage "${folder.name}"`,
            [
                { text: 'Cancel', style: 'cancel' },
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
    };

    const filtered = folders.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => navigation?.goBack()}>
                    <ArrowLeft color={theme.colors.textHeading} size={24} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.addBtn} onPress={() => setCreateModalVisible(true)}>
                    <Plus color={theme.colors.textHeading} size={22} />
                </TouchableOpacity>
            </View>

            <View style={styles.titleSection}>
                <Text style={styles.pageTitle}>Your <Text style={{ fontWeight: '700' }}>Folders</Text></Text>
                <Text style={styles.statsSubtitle}>{folders.length} folder{folders.length !== 1 ? 's' : ''}</Text>
            </View>

            <ScrollView style={styles.scrollArea} showsVerticalScrollIndicator={false}>
                {isLoading ? (
                    <ActivityIndicator style={{ marginTop: 40 }} size="large" color={theme.colors.primary} />
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
                                    <TouchableOpacity
                                        hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
                                        onPress={() => openFolderMenu(folder)}
                                    >
                                        <MoreHorizontal color={folder.color} size={20} />
                                    </TouchableOpacity>
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
                            <Text style={styles.emptyText}>No folders found.</Text>
                        )}
                    </View>
                )}
                <View style={{ height: 120 }} />
            </ScrollView>

            {/* ── Create Folder Modal ── */}
            <Modal visible={isCreateModalVisible} transparent animationType="fade">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>📁 New Folder</Text>
                        <TextInput
                            style={styles.modalInput}
                            placeholder="Folder name"
                            value={newFolderName}
                            onChangeText={setNewFolderName}
                            autoFocus
                            onSubmitEditing={handleCreateFolder}
                        />
                        <View style={styles.modalActions}>
                            <TouchableOpacity style={styles.modalBtn} onPress={() => { setCreateModalVisible(false); setNewFolderName(''); }}>
                                <Text style={styles.modalBtnText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.modalBtn, { backgroundColor: theme.colors.primary }]} onPress={handleCreateFolder}>
                                <Text style={[styles.modalBtnText, { color: '#fff' }]}>Create</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* ── Rename Folder Modal ── */}
            <Modal visible={isRenameModalVisible} transparent animationType="fade">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
                    <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>✏️ Rename Folder</Text>
                        <TextInput
                            style={styles.modalInput}
                            placeholder="New folder name"
                            value={renameValue}
                            onChangeText={setRenameValue}
                            autoFocus
                            onSubmitEditing={handleRenameFolder}
                        />
                        <View style={styles.modalActions}>
                            <TouchableOpacity style={styles.modalBtn} onPress={() => { setRenameModalVisible(false); setRenameTarget(null); }}>
                                <Text style={styles.modalBtnText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.modalBtn, { backgroundColor: theme.colors.primary }]} onPress={handleRenameFolder}>
                                <Text style={[styles.modalBtnText, { color: '#fff' }]}>Rename</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingTop: 20 },
    backBtn: { padding: 8, marginLeft: -8 },
    addBtn: { padding: 4 },

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
    modalBtnText: { color: theme.colors.textHeading, fontWeight: '600', fontSize: 14 }
});
