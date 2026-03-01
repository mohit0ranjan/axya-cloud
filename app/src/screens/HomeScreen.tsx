import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
    SafeAreaView, RefreshControl, Platform, Modal, KeyboardAvoidingView,
    Dimensions, Alert, Animated, Easing,
} from 'react-native';
import {
    Search, Plus, Folder, Upload, HardDrive, Star,
    Trash2, User, X, FileText, Image as ImageIcon,
    Film, Music, Archive, MoreHorizontal, ChevronRight,
} from 'lucide-react-native';
import { Image } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient, { uploadClient } from '../api/client';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { FileCardSkeleton, SkeletonBlock } from '../ui/Skeleton';
import AxyaLogo from '../components/AxyaLogo';

const { width } = Dimensions.get('window');

// ── Color tokens ─────────────────────────────────────────────────────────────
const C = {
    bg: '#F4F6FB',
    card: '#FFFFFF',
    primary: '#4B6EF5',
    primaryDark: '#2B4FD8',
    accent: '#FCBD0B',
    danger: '#FF4E4E',
    success: '#1FD45A',
    purple: '#9B59B6',
    text: '#1A1F36',
    muted: '#8892A4',
    border: '#EAEDF3',
    storageGrad1: '#4B6EF5',
    storageGrad2: '#2B4FD8',
};

// ── Helper: file icon config ──────────────────────────────────────────────────
const getIconConfig = (mime: string) => {
    if (!mime) return { Icon: FileText, color: C.primary, bg: '#EEF1FD' };
    if (mime.includes('image')) return { Icon: ImageIcon, color: '#F59E0B', bg: '#FEF3C7' };
    if (mime.includes('video')) return { Icon: Film, color: C.purple, bg: '#F3E8FF' };
    if (mime.includes('audio')) return { Icon: Music, color: C.success, bg: '#DCFCE7' };
    if (mime.includes('pdf')) return { Icon: FileText, color: '#EF4444', bg: '#FEE2E2' };
    if (mime.includes('zip') || mime.includes('compress')) return { Icon: Archive, color: '#F97316', bg: '#FFEDD5' };
    return { Icon: FileText, color: C.primary, bg: '#EEF1FD' };
};

const formatSize = (bytes: number) => {
    if (!bytes) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
};

const formatDate = (d: string) => {
    if (!d) return '';
    const date = new Date(d);
    const now = new Date();
    const diff = (now.getTime() - date.getTime()) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// ──────────────────────────────────────────────────────────────────────────────
export default function HomeScreen({ navigation }: any) {
    const { logout, user, token } = useContext(AuthContext);
    const { showToast } = useToast();

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [stats, setStats] = useState<any>({});
    const [recentFiles, setRecentFiles] = useState<any[]>([]);
    const [folders, setFolders] = useState<any[]>([]);
    const [recentlyAccessed, setRecentlyAccessed] = useState<any[]>([]);

    // Search
    const [showSearch, setShowSearch] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);

    // FAB
    const [fabOpen, setFabOpen] = useState(false);

    // Upload modal
    const [uploadModal, setUploadModal] = useState(false);
    const [pickedFiles, setPickedFiles] = useState<any[]>([]);
    const [chatTarget, setChatTarget] = useState('me');
    const [uploading, setUploading] = useState(false);

    // Folder modal
    const [folderModal, setFolderModal] = useState(false);
    const [folderName, setFolderName] = useState('');

    // Rename folder modal
    const [renameFolderModal, setRenameFolderModal] = useState(false);
    const [renameFolderTarget, setRenameFolderTarget] = useState<any>(null);
    const [renameFolderName, setRenameFolderName] = useState('');

    useEffect(() => { load(); }, []);

    // Debounced search
    useEffect(() => {
        if (!searchQuery.trim()) { setSearchResults([]); return; }
        const t = setTimeout(async () => {
            setSearching(true);
            try {
                const res = await apiClient.get(`/files/search?q=${encodeURIComponent(searchQuery)}`);
                if (res.data.success) {
                    setSearchResults(res.data.results);
                }
            } catch { setSearchResults([]); }
            finally { setSearching(false); }
        }, 350);
        return () => clearTimeout(t);
    }, [searchQuery]);

    const load = async () => {
        try {
            const [statsRes, filesRes, foldersRes, recentAccessedRes] = await Promise.all([
                apiClient.get('/files/stats'),
                apiClient.get('/files?limit=10&sort=created_at&order=DESC'),
                apiClient.get('/files/folders'),
                apiClient.get('/files/recent-accessed').catch(() => ({ data: { files: [] } })),
            ]);
            if (statsRes.data.success) setStats(statsRes.data);
            if (filesRes.data.success) setRecentFiles(filesRes.data.files);
            if (recentAccessedRes.data.files) setRecentlyAccessed(recentAccessedRes.data.files);
            if (foldersRes.data.success) {
                setAllFolders(foldersRes.data.folders);
                setFolders(foldersRes.data.folders.slice(0, 6));
            }
        } catch (e) {
            showToast('Could not load dashboard', 'error');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const handlePickFile = async () => {
        setFabOpen(false);
        try {
            const res = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
            if (res.canceled) return;
            setPickedFiles(res.assets);
            setUploadFolderId(null); // Reset selection
            setUploadModal(true);
        } catch { showToast('Could not pick file', 'error'); }
    };

    const [uploadProgress, setUploadProgress] = useState(0);
    const [totalUploadFiles, setTotalUploadFiles] = useState(0);
    const [currentUploadIndex, setCurrentUploadIndex] = useState(0);
    const [allFolders, setAllFolders] = useState<any[]>([]);
    const [uploadFolderId, setUploadFolderId] = useState<string | null>(null);

    const handleUpload = async () => {
        if (!pickedFiles || pickedFiles.length === 0) return;
        setUploadModal(false);
        setUploading(true);

        const token = await AsyncStorage.getItem('jwtToken');
        if (!token) {
            showToast('Session expired — please sign in again', 'error');
            setUploading(false);
            return;
        }

        setTotalUploadFiles(pickedFiles.length);
        setCurrentUploadIndex(0);

        for (let i = 0; i < pickedFiles.length; i++) {
            const file = pickedFiles[i];
            setCurrentUploadIndex(i + 1);
            setUploadProgress(0);

            try {
                const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
                const fileSize = file.size;
                const originalname = file.name;
                const mimetype = file.mimeType || 'application/octet-stream';

                // 1. Initialize Upload
                const initRes = await uploadClient.post('/files/upload/init', {
                    originalname,
                    size: fileSize,
                    mimetype,
                    telegram_chat_id: chatTarget,
                    folder_id: uploadFolderId
                });
                const { uploadId } = initRes.data;

                // 2. Upload Chunks
                let offset = 0;
                let chunkIndex = 0;

                if (Platform.OS === 'web') {
                    const blobResponse = await fetch(file.uri);
                    const blob = await blobResponse.blob();

                    while (offset < fileSize) {
                        const chunk = blob.slice(offset, offset + CHUNK_SIZE);
                        const formData = new FormData();
                        formData.append('uploadId', uploadId);
                        formData.append('chunkIndex', String(chunkIndex));
                        formData.append('chunk', new File([chunk], originalname, { type: mimetype }));

                        await uploadClient.post('/files/upload/chunk', formData);
                        offset += CHUNK_SIZE;
                        chunkIndex++;
                        setUploadProgress(Math.min((offset / fileSize) * 50, 50));
                    }
                } else {
                    const FileSystem = require('expo-file-system');
                    while (offset < fileSize) {
                        const length = Math.min(CHUNK_SIZE, fileSize - offset);
                        const chunkBase64 = await FileSystem.readAsStringAsync(file.uri, {
                            encoding: FileSystem.EncodingType.Base64,
                            position: offset,
                            length: length
                        });

                        await uploadClient.post('/files/upload/chunk', {
                            uploadId,
                            chunkIndex,
                            chunkBase64
                        });

                        offset += length;
                        chunkIndex++;
                        setUploadProgress(Math.min((offset / fileSize) * 50, 50));
                    }
                }

                // 3. Complete Upload & Begin Telegram Transfer
                setUploadProgress(50);
                await uploadClient.post('/files/upload/complete', { uploadId });

                // 4. Poll for Telegram Progress
                await new Promise<void>((resolve, reject) => {
                    const timer = setInterval(async () => {
                        try {
                            const statusRes = await apiClient.get(`/files/upload/status/${uploadId}`);
                            const state = statusRes.data;

                            if (state.status === 'completed') {
                                clearInterval(timer);
                                setUploadProgress(100);
                                load();
                                resolve();
                            } else if (state.status === 'error') {
                                clearInterval(timer);
                                reject(new Error(state.error || 'Telegram upload failed'));
                            } else {
                                setUploadProgress(50 + (state.progress / 2));
                            }
                        } catch (e) {
                            clearInterval(timer);
                            reject(new Error('Lost connection to upload status'));
                        }
                    }, 1000);
                });

            } catch (e: any) {
                const msg = e.response?.data?.error || e.message || 'Upload failed';
                showToast(`Failed on ${file.name}: ${msg}`, 'error');
                break; // Stop uploading rest of files on failure
            }
        }

        setUploading(false);
        setPickedFiles([]);

        if (pickedFiles.length > 1) {
            showToast("All files uploaded! ✅");
        } else if (pickedFiles.length === 1) {
            showToast(`"${pickedFiles[0].name}" uploaded! ✅`);
        }
    };


    const handleCreateFolder = async () => {
        if (!folderName.trim()) return;
        try {
            const res = await apiClient.post('/files/folder', { name: folderName.trim() });
            if (res.data.success) {
                showToast('Folder created!');
                setFolderName('');
                setFolderModal(false);
                load();
            }
        } catch (e: any) { showToast(e.response?.data?.error || 'Could not create folder', 'error'); }
    };

    const handleRenameFolder = async () => {
        if (!renameFolderName.trim() || !renameFolderTarget) return;
        try {
            const res = await apiClient.patch(`/files/folder/${renameFolderTarget.id}`, { name: renameFolderName.trim() });
            if (res.data.success) {
                showToast('Folder renamed!');
                setRenameFolderModal(false);
                setRenameFolderTarget(null);
                load();
            }
        } catch (e: any) { showToast(e.response?.data?.error || 'Could not rename folder', 'error'); }
    };

    // ── Storage card percentage ────────────────────────────────────────────
    const usedGB = ((stats.totalBytes || 0) / (1024 ** 3)).toFixed(2);
    const quotaGB = 5;
    const pct = Math.min(((stats.totalBytes || 0) / (quotaGB * 1024 ** 3)) * 100, 100);

    const displayItems = searchQuery ? searchResults : recentFiles;

    return (
        <SafeAreaView style={s.root}>

            {/* ── HEADER ───────────────────────────────────────────────────── */}
            <View style={s.header}>
                {showSearch ? (
                    <View style={s.searchBar}>
                        <Search color={C.muted} size={18} />
                        <TextInput
                            style={s.searchInput}
                            placeholder="Search files & folders…"
                            placeholderTextColor={C.muted}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            autoFocus
                        />
                        <TouchableOpacity onPress={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }}>
                            <X color={C.muted} size={20} />
                        </TouchableOpacity>
                    </View>
                ) : (
                    <>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                            <AxyaLogo size={32} showText={false} />
                            <View>
                                <Text style={s.greeting}>Hello, {user?.name?.split(' ')[0] || user?.username || 'User'} 👋</Text>
                                <Text style={s.subGreeting}>Welcome to Axya</Text>
                            </View>
                        </View>
                        <TouchableOpacity style={s.headerIconBtn} onPress={() => setShowSearch(true)}>
                            <Search color={C.text} size={22} />
                        </TouchableOpacity>
                        <TouchableOpacity style={s.avatar} onPress={() => navigation.navigate('Profile')}>
                            <User color="#fff" size={20} />
                        </TouchableOpacity>
                    </>
                )}
            </View>

            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={s.scrollContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} tintColor={C.primary}
                        onRefresh={() => { setRefreshing(true); load(); }} />
                }
            >
                {/* ═══════════════════════════════════════════════════════════
                    STORAGE CARD
                ═══════════════════════════════════════════════════════════ */}
                {!searchQuery && (
                    <View style={s.storageCard}>
                        {/* Top row */}
                        <View style={s.storageTop}>
                            <View style={s.storageIconBox}>
                                <HardDrive color="#fff" size={22} />
                            </View>
                            <View style={{ flex: 1, marginLeft: 12 }}>
                                <Text style={s.storageTitle}>TeleDrive</Text>
                                <Text style={s.storageSubtitle}>Cloud Storage</Text>
                            </View>
                            <TouchableOpacity onPress={() => navigation.navigate('Profile')}>
                                <MoreHorizontal color="rgba(255,255,255,0.6)" size={22} />
                            </TouchableOpacity>
                        </View>

                        {/* Size display */}
                        <View style={s.storageSizeRow}>
                            <Text style={s.storageBig}>{usedGB} GB</Text>
                            <Text style={s.storageOf}>/ {quotaGB} GB</Text>
                        </View>

                        {/* Progress bar */}
                        <View style={s.progressTrack}>
                            <View style={[s.progressFill, { width: `${pct}%` as any }]} />
                        </View>

                        {/* Stats row */}
                        <View style={s.storageStats}>
                            <View style={s.storageStat}>
                                <View style={[s.statDot, { backgroundColor: C.accent }]} />
                                <Text style={s.statStatText}>{stats.totalFiles || 0} Files</Text>
                            </View>
                            <View style={s.storageStat}>
                                <View style={[s.statDot, { backgroundColor: 'rgba(255,255,255,0.5)' }]} />
                                <Text style={s.statStatText}>{stats.totalFolders || 0} Folders</Text>
                            </View>
                        </View>
                    </View>
                )}

                {/* ═══════════════════════════════════════════════════════════
                    FOLDERS SECTION
                ═══════════════════════════════════════════════════════════ */}
                {!searchQuery && (
                    <>
                        <View style={s.sectionRow}>
                            <Text style={s.sectionLabel}>FOLDERS</Text>
                            <TouchableOpacity style={s.seeAllBtn}
                                onPress={() => navigation.navigate('Folders')}>
                                <Text style={s.seeAllText}>See all</Text>
                                <ChevronRight color={C.primary} size={16} />
                            </TouchableOpacity>
                        </View>

                        {loading ? (
                            <View style={s.folderGrid}>
                                {[1, 2, 3, 4].map(i => (
                                    <View key={i} style={s.folderGridCard}>
                                        <SkeletonBlock width={44} height={44} borderRadius={12} />
                                        <SkeletonBlock width="70%" height={13} borderRadius={6} style={{ marginTop: 28 }} />
                                        <SkeletonBlock width="50%" height={11} borderRadius={5} style={{ marginTop: 6 }} />
                                    </View>
                                ))}
                            </View>
                        ) : folders.length === 0 ? (
                            <TouchableOpacity style={s.emptyFolder}
                                onPress={() => { setFabOpen(false); setFolderModal(true); }}>
                                <Folder color={C.primary} size={22} />
                                <Text style={s.emptyFolderText}>Create your first folder</Text>
                            </TouchableOpacity>
                        ) : (
                            <View style={s.folderGrid}>
                                <TouchableOpacity
                                    style={[s.folderGridCard, { backgroundColor: '#EEF1FD' }]}
                                    onPress={() => navigation.navigate('Files')}
                                >
                                    <View style={[s.fileIcon, { backgroundColor: 'rgba(75, 110, 245, 0.1)' }]}>
                                        <HardDrive color={C.primary} size={24} />
                                    </View>
                                    <View>
                                        <Text style={[s.folderGridName, { color: C.primary }]} numberOfLines={1}>All Files</Text>
                                        <Text style={s.folderGridMeta}>{stats.totalFiles || 0} items</Text>
                                    </View>
                                </TouchableOpacity>
                                {folders.map((folder, idx) => {
                                    // Cycle through pastel color pairs
                                    const palettes = [
                                        { bg: '#EEF1FD', icon: '#4B6EF5' },
                                        { bg: '#FEF3C7', icon: '#D97706' },
                                        { bg: '#FEE2E2', icon: '#EF4444' },
                                        { bg: '#CCFBF1', icon: '#0D9488' },
                                        { bg: '#F3E8FF', icon: '#9333EA' },
                                        { bg: '#DCFCE7', icon: '#16A34A' },
                                    ];
                                    const pal = palettes[idx % palettes.length];
                                    return (
                                        <TouchableOpacity
                                            key={folder.id}
                                            style={[s.folderGridCard, { backgroundColor: pal.bg }]}
                                            activeOpacity={0.75}
                                            onPress={() => navigation.navigate('FolderFiles',
                                                { folderId: folder.id, folderName: folder.name })}
                                        >
                                            <View style={s.folderGridTop}>
                                                <Folder color={pal.icon} size={28} fill={pal.icon} />
                                                <TouchableOpacity
                                                    hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                                                    onPress={() => {
                                                        Alert.alert(
                                                            "Folder Options",
                                                            `Manage "${folder.name}"`,
                                                            [
                                                                { text: "Cancel", style: "cancel" },
                                                                {
                                                                    text: "Rename",
                                                                    onPress: () => {
                                                                        setRenameFolderTarget(folder);
                                                                        setRenameFolderName(folder.name);
                                                                        setRenameFolderModal(true);
                                                                    }
                                                                },
                                                                {
                                                                    text: "Delete Folder",
                                                                    style: "destructive",
                                                                    onPress: async () => {
                                                                        try {
                                                                            const res = await apiClient.delete(`/files/folder/${folder.id}`);
                                                                            if (res.data.success) {
                                                                                showToast('Folder moved to trash');
                                                                                load();
                                                                            }
                                                                        } catch (e: any) {
                                                                            showToast(e.response?.data?.error || 'Could not delete folder', 'error');
                                                                        }
                                                                    }
                                                                }
                                                            ]
                                                        );
                                                    }}
                                                >
                                                    <MoreHorizontal color={pal.icon} size={16} opacity={0.6} />
                                                </TouchableOpacity>
                                            </View>
                                            <Text style={[s.folderGridName, { color: pal.icon }]} numberOfLines={1}>
                                                {folder.name}
                                            </Text>
                                            <Text style={s.folderGridMeta}>
                                                {folder.file_count || 0} files
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                                {/* Add folder card */}
                                <TouchableOpacity
                                    style={[s.folderGridCard, s.folderAddCard]}
                                    onPress={() => setFolderModal(true)}
                                    activeOpacity={0.75}
                                >
                                    <View style={s.folderAddIcon}>
                                        <Plus color={C.primary} size={22} />
                                    </View>
                                    <Text style={[s.folderGridName, { color: C.primary }]}>New Folder</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                    </>
                )}

                {/* ═══════════════════════════════════════════════════════════
                    RECENTLY OPENED SECTION
                ═══════════════════════════════════════════════════════════ */}
                {!searchQuery && recentlyAccessed.length > 0 && (
                    <>
                        <View style={[s.sectionRow, { marginTop: 8 }]}>
                            <Text style={s.sectionLabel}>RECENTLY OPENED</Text>
                        </View>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}>
                            {recentlyAccessed.slice(0, 6).map(f => {
                                const isMedia = f.mime_type?.includes('image') || f.mime_type?.includes('video');
                                const iconBg = isMedia ? '#FEF3C7' : '#EEF1FD';
                                return (
                                    <TouchableOpacity
                                        key={f.id}
                                        style={s.recentChip}
                                        activeOpacity={0.75}
                                        onPress={() => navigation.navigate('FilePreview', { file: f })}
                                    >
                                        {isMedia && token ? (
                                            <Image
                                                source={{ uri: `${apiClient.defaults.baseURL}/files/${f.id}/thumbnail`, headers: { Authorization: `Bearer ${token}` } }}
                                                style={s.recentChipImage}
                                                contentFit="cover"
                                                cachePolicy="disk"
                                            />
                                        ) : (
                                            <View style={[s.recentChipIcon, { backgroundColor: iconBg }]}>
                                                <FileText color={C.primary} size={16} />
                                            </View>
                                        )}
                                        <Text style={s.recentChipName} numberOfLines={1}>{f.name}</Text>
                                    </TouchableOpacity>
                                );
                            })}
                        </ScrollView>
                    </>
                )}

                {/* ═══════════════════════════════════════════════════════════
                    RECENT FILES
                ═══════════════════════════════════════════════════════════ */}
                <View style={[s.sectionRow, { marginTop: searchQuery ? 0 : 8 }]}>
                    <Text style={s.sectionLabel}>
                        {searchQuery ? `RESULTS FOR "${searchQuery.toUpperCase()}"` : 'RECENT FILES'}
                    </Text>
                    {!searchQuery && (
                        <TouchableOpacity style={s.seeAllBtn} onPress={() => navigation.navigate('Files')}>
                            <Text style={s.seeAllText}>See all</Text>
                            <ChevronRight color={C.primary} size={16} />
                        </TouchableOpacity>
                    )}
                </View>

                {loading || searching ? (
                    <View style={{ paddingHorizontal: 20 }}>
                        {[1, 2, 3, 4].map(i => <FileCardSkeleton key={i} />)}
                    </View>
                ) : displayItems.length === 0 ? (
                    <View style={s.emptyFiles}>
                        <View style={s.emptyFilesIcon}>
                            <HardDrive color={C.muted} size={36} />
                        </View>
                        <Text style={s.emptyTitle}>
                            {searchQuery ? 'No results found' : 'No files yet'}
                        </Text>
                        <Text style={s.emptyBody}>
                            {searchQuery ? 'Try a different keyword' : 'Upload a file to get started'}
                        </Text>
                    </View>
                ) : (
                    <View style={s.fileList}>
                        {displayItems.map((item: any) => {
                            const isFolder = item.mime_type === 'inode/directory' || item.result_type === 'folder';
                            const cfg = isFolder
                                ? { Icon: Folder, color: C.primary, bg: '#EEF1FD' }
                                : getIconConfig(item.mime_type || '');
                            const { Icon, color, bg } = cfg;
                            return (
                                <TouchableOpacity
                                    key={item.id}
                                    style={s.fileRow}
                                    activeOpacity={0.7}
                                    onPress={() => {
                                        if (isFolder) {
                                            navigation.navigate('FolderFiles', { folderId: item.id, folderName: item.name });
                                        } else {
                                            navigation.navigate('FilePreview', { file: item });
                                        }
                                    }}
                                >
                                    <View style={[s.fileIcon, { backgroundColor: bg, overflow: 'hidden' }]}>
                                        {!isFolder && (item.mime_type?.includes('image') || item.mime_type?.includes('video')) ? (
                                            <Image
                                                source={{
                                                    uri: `${apiClient.defaults.baseURL}/files/${item.id}/thumbnail`,
                                                    headers: { Authorization: `Bearer ${token}` } // ensure it gets through if needed, though stream uses redirect
                                                }}
                                                style={{ width: '100%', height: '100%' }}
                                                contentFit="cover"
                                                cachePolicy="disk"
                                            />
                                        ) : (
                                            <Icon color={color} size={22} />
                                        )}
                                    </View>
                                    <View style={s.fileInfo}>
                                        <Text style={s.fileName} numberOfLines={1}>
                                            {item.name || item.file_name}
                                        </Text>
                                        <Text style={s.fileMeta}>
                                            {isFolder ? 'Folder' : [
                                                formatSize(item.size),
                                                formatDate(item.created_at),
                                            ].filter(Boolean).join(' · ')}
                                        </Text>
                                    </View>
                                    {item.is_starred && (
                                        <Star color={C.accent} size={14} fill={C.accent} />
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                    </View>
                )}

                <View style={{ height: 140 }} />
            </ScrollView>

            {/* ═══════════════════════════════════════════════════════════════
                BOTTOM NAV
            ═══════════════════════════════════════════════════════════════ */}
            <View style={s.navBar}>
                <TouchableOpacity style={s.navItem} onPress={() => { }}>
                    <HardDrive color={C.primary} size={22} />
                    <Text style={[s.navLabel, { color: C.primary }]}>Home</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.navItem} onPress={() => navigation.navigate('Folders')}>
                    <Folder color={C.muted} size={22} />
                    <Text style={s.navLabel}>Folders</Text>
                </TouchableOpacity>

                {/* FAB */}
                <TouchableOpacity style={s.fab} onPress={() => setFabOpen(true)} activeOpacity={0.85}>
                    <Plus color="#fff" size={28} strokeWidth={2.5} />
                </TouchableOpacity>

                <TouchableOpacity style={s.navItem} onPress={() => navigation.navigate('Starred')}>
                    <Star color={C.muted} size={22} />
                    <Text style={s.navLabel}>Starred</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.navItem} onPress={() => navigation.navigate('Profile')}>
                    <User color={C.muted} size={22} />
                    <Text style={s.navLabel}>Profile</Text>
                </TouchableOpacity>
            </View>

            {/* ═══════════════════════════════════════════════════════════════
                FAB ACTION SHEET
            ═══════════════════════════════════════════════════════════════ */}
            <Modal visible={fabOpen} transparent animationType="slide">
                <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setFabOpen(false)}>
                    <View style={s.sheet}>
                        <View style={s.sheetHandle} />
                        <Text style={s.sheetTitle}>Create New</Text>

                        <TouchableOpacity style={s.sheetRow} onPress={handlePickFile} activeOpacity={0.7}>
                            <View style={[s.sheetRowIcon, { backgroundColor: '#EEF1FD' }]}>
                                <Upload color={C.primary} size={22} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={s.sheetRowTitle}>Upload File</Text>
                                <Text style={s.sheetRowSub}>Pick any file from your device</Text>
                            </View>
                            <ChevronRight color={C.muted} size={18} />
                        </TouchableOpacity>

                        <TouchableOpacity style={s.sheetRow}
                            onPress={() => { setFabOpen(false); setFolderModal(true); }} activeOpacity={0.7}>
                            <View style={[s.sheetRowIcon, { backgroundColor: '#FEF3C7' }]}>
                                <Folder color="#D97706" size={22} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={s.sheetRowTitle}>New Folder</Text>
                                <Text style={s.sheetRowSub}>Organise your files</Text>
                            </View>
                            <ChevronRight color={C.muted} size={18} />
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* ═══════════════════════════════════════════════════════════════
                UPLOAD CONFIRM MODAL
            ═══════════════════════════════════════════════════════════════ */}
            <Modal visible={uploadModal} transparent animationType="fade">
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={s.centeredOverlay}>
                    <View style={s.modalCard}>
                        <Text style={s.modalTitle}>📤 Upload File</Text>
                        <View style={s.filePill}>
                            <FileText color={C.primary} size={18} />
                            <Text style={s.filePillText} numberOfLines={1}>{pickedFiles.length > 1 ? `${pickedFiles.length} files selected` : pickedFiles[0]?.name}</Text>
                        </View>
                        <Text style={s.modalLabel}>Upload To Folder</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
                            <TouchableOpacity
                                style={[s.folderChip, uploadFolderId === null && s.folderChipSelected]}
                                onPress={() => setUploadFolderId(null)}
                            >
                                <Text style={[s.folderChipText, uploadFolderId === null && s.folderChipTextSelected]}>
                                    Home (Root)
                                </Text>
                            </TouchableOpacity>
                            {allFolders.map(f => (
                                <TouchableOpacity
                                    key={f.id}
                                    style={[s.folderChip, uploadFolderId === f.id && s.folderChipSelected]}
                                    onPress={() => setUploadFolderId(f.id)}
                                >
                                    <Text style={[s.folderChipText, uploadFolderId === f.id && s.folderChipTextSelected]}>
                                        {f.name}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                        <View style={s.modalBtns}>
                            <TouchableOpacity style={s.btnCancel}
                                onPress={() => { setUploadModal(false); setPickedFiles([]); }}>
                                <Text style={s.btnCancelTxt}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.btnConfirm} onPress={handleUpload} disabled={uploading}>
                                <Text style={s.btnConfirmTxt}>{uploading ? 'Uploading…' : 'Upload'}</Text>
                            </TouchableOpacity>
                        </View>
                        {uploading && (
                            <View style={{ marginTop: 20 }}>
                                <View style={s.progressTrack}>
                                    <View style={[s.progressFill, { width: `${Math.round(uploadProgress)}%` as any }]} />
                                </View>
                                <Text style={{ textAlign: 'center', fontSize: 12, color: C.muted, marginTop: 4 }}>
                                    {Math.round(uploadProgress)}% • File {currentUploadIndex} of {totalUploadFiles}
                                </Text>
                            </View>
                        )}
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* ═══════════════════════════════════════════════════════════════
                NEW FOLDER MODAL
            ═══════════════════════════════════════════════════════════════ */}
            <Modal visible={folderModal} transparent animationType="fade">
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={s.centeredOverlay}>
                    <View style={s.modalCard}>
                        <Text style={s.modalTitle}>📁 New Folder</Text>
                        <TextInput
                            style={s.modalInput}
                            value={folderName}
                            onChangeText={setFolderName}
                            placeholder="Folder name…"
                            placeholderTextColor={C.muted}
                            autoFocus
                            returnKeyType="done"
                            onSubmitEditing={handleCreateFolder}
                        />
                        <View style={s.modalBtns}>
                            <TouchableOpacity style={s.btnCancel}
                                onPress={() => { setFolderModal(false); setFolderName(''); }}>
                                <Text style={s.btnCancelTxt}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.btnConfirm} onPress={handleCreateFolder}>
                                <Text style={s.btnConfirmTxt}>Create</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* ── Rename Folder Modal ───────────────────────────────── */}
            <Modal visible={renameFolderModal} transparent animationType="fade">
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={s.centeredOverlay}>
                    <View style={s.modalCard}>
                        <Text style={s.modalTitle}>✏️ Rename Folder</Text>
                        <TextInput
                            style={s.modalInput}
                            value={renameFolderName}
                            onChangeText={setRenameFolderName}
                            placeholder="New folder name…"
                            placeholderTextColor={C.muted}
                            autoFocus
                            returnKeyType="done"
                            onSubmitEditing={handleRenameFolder}
                        />
                        <View style={s.modalBtns}>
                            <TouchableOpacity style={s.btnCancel}
                                onPress={() => { setRenameFolderModal(false); setRenameFolderTarget(null); }}>
                                <Text style={s.btnCancelTxt}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={s.btnConfirm} onPress={handleRenameFolder}>
                                <Text style={s.btnConfirmTxt}>Rename</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </SafeAreaView>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },

    /* Header */
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: Platform.OS === 'web' ? 44 : 26, // More breathing room for Web & mobile notch
        paddingBottom: 16,
        backgroundColor: C.bg,
    },
    avatar: {
        width: 46, height: 46, borderRadius: 23, backgroundColor: C.primary,
        justifyContent: 'center', alignItems: 'center',
        shadowColor: C.primary, shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
    },
    greeting: { fontSize: 18, fontWeight: '700', color: C.text },
    subGreeting: { fontSize: 13, color: C.muted, marginTop: 2 },
    headerIconBtn: {
        width: 46, height: 46, borderRadius: 23, backgroundColor: C.card,
        justifyContent: 'center', alignItems: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
    },
    searchBar: {
        flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: C.card, borderRadius: 23, paddingHorizontal: 16, height: 48,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
    },
    searchInput: { flex: 1, fontSize: 15, color: C.text },

    scrollContent: { paddingTop: 4, paddingBottom: 20 },   // ← tight top so card starts cleanly

    /* Storage Card */
    storageCard: {
        marginHorizontal: 20,
        borderRadius: 24,
        backgroundColor: C.primary,
        padding: 22,
        marginTop: 4,           // small gap from header
        marginBottom: 32,       // ↑ breathing room before FOLDERS
        shadowColor: C.primary, shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.4, shadowRadius: 20, elevation: 12,
    },
    storageTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
    storageIconBox: {
        width: 44, height: 44, borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center', alignItems: 'center',
    },
    storageTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
    storageSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 2 },
    storageSizeRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 14 },
    storageBig: { fontSize: 34, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
    storageOf: { fontSize: 16, color: 'rgba(255,255,255,0.6)', marginLeft: 6, fontWeight: '500' },
    progressTrack: {
        height: 6, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 3, marginBottom: 16,
    },
    progressFill: { height: 6, backgroundColor: C.accent, borderRadius: 3 },
    storageStats: { flexDirection: 'row', gap: 20 },
    storageStat: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    statDot: { width: 8, height: 8, borderRadius: 4 },
    statStatText: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '500' },

    /* Section headers */
    sectionRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20,
        marginBottom: 16,       // ↑ more space before cards
    },
    sectionLabel: { fontSize: 12, fontWeight: '700', color: C.muted, letterSpacing: 1.2 },
    seeAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    seeAllText: { fontSize: 13, fontWeight: '600', color: C.primary },

    /* Folders - 2 column GRID */
    folderGrid: {
        flexDirection: 'row', flexWrap: 'wrap', gap: 14,   // ↑ wider gutter
        paddingHorizontal: 20, marginBottom: 28,            // ↑ more space after grid
    },
    folderGridCard: {
        width: '47%', borderRadius: 20, padding: 18,        // ↑ more internal padding
        minHeight: 138,
        justifyContent: 'space-between',
        shadowColor: '#96A0B5', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.09, shadowRadius: 12, elevation: 3,
    },
    folderGridTop: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
        marginBottom: 'auto' as any,
    },
    folderGridName: { fontSize: 14, fontWeight: '700', marginBottom: 4, marginTop: 12 },
    folderGridMeta: { fontSize: 12, color: C.muted, fontWeight: '500' },
    folderAddCard: {
        backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border,
        borderStyle: 'dashed', elevation: 0, shadowOpacity: 0,
        alignItems: 'center', justifyContent: 'center',
    },
    folderAddIcon: {
        width: 48, height: 48, borderRadius: 14,
        backgroundColor: '#EEF1FD', justifyContent: 'center', alignItems: 'center',
        marginBottom: 10,
    },

    emptyFolder: {
        marginHorizontal: 20, height: 64, backgroundColor: C.card, borderRadius: 16,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        borderWidth: 1.5, borderColor: C.border, borderStyle: 'dashed', marginBottom: 8,
    },
    emptyFolderText: { fontSize: 14, fontWeight: '600', color: C.primary },

    /* File list */
    fileList: { paddingHorizontal: 20, gap: 4 },
    fileRow: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: C.card,
        paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18,
        marginBottom: 10,       // ↑ more gap between rows
        shadowColor: '#96A0B5', shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.08, shadowRadius: 10, elevation: 2,
    },
    fileIcon: {
        width: 46, height: 46, borderRadius: 14,
        justifyContent: 'center', alignItems: 'center',
    },
    fileInfo: { flex: 1, marginHorizontal: 14 },
    fileName: { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 4 },
    fileMeta: { fontSize: 12, color: C.muted, fontWeight: '500' },

    /* Empty state */
    emptyFiles: { alignItems: 'center', paddingTop: 40, paddingBottom: 32 },
    emptyFilesIcon: {
        width: 76, height: 76, borderRadius: 24,
        backgroundColor: C.card, justifyContent: 'center', alignItems: 'center',
        marginBottom: 18,
        shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
    },
    emptyTitle: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 8 },
    emptyBody: { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 20 },

    /* Bottom nav */
    navBar: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: 86,                 // ↑ slightly taller for comfort
        backgroundColor: C.card,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
        paddingBottom: 14,          // ↑ more bottom padding
        paddingHorizontal: 8,
        borderTopWidth: 1, borderTopColor: C.border,
        shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.06, shadowRadius: 12, elevation: 12,
    },
    navItem: { alignItems: 'center', gap: 5, flex: 1 },
    navLabel: { fontSize: 11, fontWeight: '600', color: C.muted },
    fab: {
        width: 60, height: 60, borderRadius: 30, backgroundColor: C.primary,
        justifyContent: 'center', alignItems: 'center',
        shadowColor: C.primary, shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.45, shadowRadius: 14, elevation: 10,
        marginTop: -20,             // ↑ float higher above nav bar
    },

    /* Modals / Sheets */
    overlay: { flex: 1, backgroundColor: 'rgba(10,10,30,0.45)', justifyContent: 'flex-end' },
    sheet: {
        backgroundColor: C.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
        padding: 28, paddingBottom: 48,
    },
    sheetHandle: {
        width: 40, height: 4, backgroundColor: C.border,
        borderRadius: 2, alignSelf: 'center', marginBottom: 24,
    },
    sheetTitle: { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 24 },
    sheetRow: {
        flexDirection: 'row', alignItems: 'center', gap: 16,
        paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border,
    },
    sheetRowIcon: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
    sheetRowTitle: { fontSize: 16, fontWeight: '600', color: C.text, marginBottom: 2 },
    sheetRowSub: { fontSize: 12, color: C.muted },

    centeredOverlay: {
        flex: 1, backgroundColor: 'rgba(10,10,30,0.45)',
        justifyContent: 'center', alignItems: 'center', padding: 24,
    },
    modalCard: {
        width: '100%', backgroundColor: C.card, borderRadius: 24, padding: 24,
        shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 24, elevation: 16,
    },
    modalTitle: { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 16 },
    filePill: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: '#EEF1FD', borderRadius: 12, paddingHorizontal: 14,
        paddingVertical: 10, marginBottom: 20,
    },
    filePillText: { flex: 1, fontSize: 14, fontWeight: '600', color: C.primary },
    modalLabel: { fontSize: 12, fontWeight: '600', color: C.muted, marginBottom: 8, letterSpacing: 0.5 },
    modalInput: {
        borderWidth: 1.5, borderColor: C.border, borderRadius: 14,
        paddingHorizontal: 16, height: 50, fontSize: 15, color: C.text, marginBottom: 24,
        backgroundColor: C.bg,
    },
    folderChip: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: C.bg,
        borderWidth: 1.5,
        borderColor: C.border,
        borderRadius: 20,
        marginRight: 10,
    },
    folderChipSelected: {
        backgroundColor: '#EEF1FD',
        borderColor: C.primary,
    },
    folderChipText: {
        fontSize: 14,
        color: C.muted,
        fontWeight: '600',
    },
    folderChipTextSelected: {
        color: C.primary,
    },
    modalBtns: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end' },
    btnCancel: {
        paddingHorizontal: 20, paddingVertical: 13, borderRadius: 12, backgroundColor: C.bg,
    },
    btnCancelTxt: { fontWeight: '600', color: C.text, fontSize: 14 },
    btnConfirm: {
        paddingHorizontal: 24, paddingVertical: 13, borderRadius: 12, backgroundColor: C.primary,
        shadowColor: C.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
    },
    btnConfirmTxt: { fontWeight: '700', color: '#fff', fontSize: 14 },
    // Recently Opened chips
    recentChip: {
        width: 88, alignItems: 'center', marginBottom: 4,
    },
    recentChipImage: {
        width: 72, height: 72, borderRadius: 18, marginBottom: 6,
    },
    recentChipIcon: {
        width: 72, height: 72, borderRadius: 18, justifyContent: 'center', alignItems: 'center', marginBottom: 6,
    },
    recentChipName: {
        fontSize: 11, fontWeight: '600', color: C.text, textAlign: 'center',
    },
});
