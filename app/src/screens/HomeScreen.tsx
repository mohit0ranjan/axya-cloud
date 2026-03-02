import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
    SafeAreaView, RefreshControl, Platform, Modal, KeyboardAvoidingView,
    Dimensions, Alert, Animated, Easing,
} from 'react-native';
import {
    Search, Plus, Folder, Upload, HardDrive, Star,
    Trash2, User, X, FileText, Image as ImageIcon,
    Film, Music, Archive, MoreHorizontal, ChevronRight, Activity,
} from 'lucide-react-native';


import { Image } from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient, { uploadClient } from '../services/apiClient';
import { AuthContext } from '../context/AuthContext';
import { useUpload } from '../context/UploadContext';
import { useApiCacheStore } from '../context/ApiCacheStore';
import { useToast } from '../context/ToastContext';
import { FileCardSkeleton, SkeletonBlock } from '../ui/Skeleton';
import { theme } from '../ui/theme';
import { useTheme } from '../context/ThemeContext';


import AxyaLogo from '../components/AxyaLogo';
import { useServerKeepAlive } from '../hooks/useServerKeepAlive';

const { width } = Dimensions.get('window');

// ── Static color tokens (used by StyleSheet.create which runs outside render) ──
const CS = {
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
};

// ── Helper: file icon config ──────────────────────────────────────────────────
const getIconConfig = (mime: string) => {
    if (!mime) return { Icon: FileText, color: CS.primary, bg: '#EEF1FD' };
    if (mime.includes('image')) return { Icon: ImageIcon, color: '#F59E0B', bg: '#FEF3C7' };
    if (mime.includes('video')) return { Icon: Film, color: CS.purple, bg: '#F3E8FF' };
    if (mime.includes('audio')) return { Icon: Music, color: CS.success, bg: '#DCFCE7' };
    if (mime.includes('pdf')) return { Icon: FileText, color: '#EF4444', bg: '#FEE2E2' };
    if (mime.includes('zip') || mime.includes('compress')) return { Icon: Archive, color: '#F97316', bg: '#FFEDD5' };
    return { Icon: FileText, color: CS.primary, bg: '#EEF1FD' };
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
    const { theme, isDark } = useTheme();
    useServerKeepAlive(); // ✅ keeps Render from sleeping every 10 minutes

    // Dynamic color tokens — react to dark/light mode
    const C = {
        bg: theme.colors.background,
        card: theme.colors.card,
        primary: theme.colors.primary,
        primaryDark: isDark ? '#4B6EF5' : '#2B4FD8',
        accent: theme.colors.accent,
        danger: theme.colors.danger,
        success: theme.colors.success,
        purple: isDark ? '#A855F7' : '#9B59B6',
        text: theme.colors.textHeading,
        muted: theme.colors.textBody,
        border: theme.colors.border,
        storageGrad1: theme.colors.primary,
        storageGrad2: isDark ? '#4B6EF5' : '#2B4FD8',
        inputBg: theme.colors.inputBg,
    };

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [stats, setStats] = useState<any>({});
    const [recentFiles, setRecentFiles] = useState<any[]>([]);
    const [folders, setFolders] = useState<any[]>([]);
    const [recentlyAccessed, setRecentlyAccessed] = useState<any[]>([]);
    const [activity, setActivity] = useState<any[]>([]);


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


    // Folder modal
    const [folderModal, setFolderModal] = useState(false);
    const [folderName, setFolderName] = useState('');

    // Rename folder modal
    const [renameFolderModal, setRenameFolderModal] = useState(false);
    const [renameFolderTarget, setRenameFolderTarget] = useState<any>(null);
    const [renameFolderName, setRenameFolderName] = useState('');

    const { homeData, setHomeData } = useApiCacheStore();

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

    useEffect(() => {
        if (homeData) { // Instantiate instantly from cache to prevent empty screen flashes
            setStats(homeData.stats);
            setRecentFiles(homeData.files);
            setFolders(homeData.folders.slice(0, 6));
            setAllFolders(homeData.folders);
            setRecentlyAccessed(homeData.recent);
            setActivity(homeData.activity);
            setLoading(false);
        }
        load();
    }, []);

    const load = async (isRefresh = false) => {
        if (!homeData && !isRefresh) setLoading(true);
        try {
            // ✅ Fix #14: stagger requests on cold start to avoid bursting Render
            // When cache exists user already sees data, so fire all in parallel (fast refresh)
            // When cache is empty (first load), stagger by 150ms each to not wake server with 5 simultaneous hits
            let statsRes, filesRes, foldersRes, recentAccessedRes, activityRes;

            if (homeData) {
                // Cache warm — parallel is fine, user already sees content
                [statsRes, filesRes, foldersRes, recentAccessedRes, activityRes] = await Promise.all([
                    apiClient.get('/files/stats'),
                    apiClient.get('/files?limit=10&sort=created_at&order=DESC'),
                    apiClient.get('/files/folders'),
                    apiClient.get('/files/recent-accessed').catch(() => ({ data: { files: [] } })),
                    apiClient.get('/files/activity?limit=5').catch(() => ({ data: { success: true, activity: [] } })),
                ]);
            } else {
                // Cold start — stagger to avoid 5-request burst hitting Render wake-up
                const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
                statsRes = await apiClient.get('/files/stats');
                await delay(150);
                filesRes = await apiClient.get('/files?limit=10&sort=created_at&order=DESC');
                await delay(150);
                foldersRes = await apiClient.get('/files/folders');
                // These two are non-critical, fire together after core data
                [recentAccessedRes, activityRes] = await Promise.all([
                    apiClient.get('/files/recent-accessed').catch(() => ({ data: { files: [] } })),
                    apiClient.get('/files/activity?limit=5').catch(() => ({ data: { success: true, activity: [] } })),
                ]);
            }

            const newStats = statsRes.data.success ? statsRes.data : {};
            const newFiles = filesRes.data.success ? filesRes.data.files : [];
            const newFolders = foldersRes.data.success ? foldersRes.data.folders : [];
            const newRecent = recentAccessedRes.data.files || [];
            const newActivity = activityRes.data.success ? activityRes.data.activity : [];

            setHomeData({ stats: newStats, files: newFiles, folders: newFolders, recent: newRecent, activity: newActivity });

            setStats(newStats);
            setRecentFiles(newFiles);
            setFolders(newFolders.slice(0, 6));
            setAllFolders(newFolders);
            setRecentlyAccessed(newRecent);
            setActivity(newActivity);

        } catch (e) {
            if (!homeData) showToast('Could not load dashboard', 'error');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    const { tasks, addUpload } = useUpload();
    const globalUploading = tasks.some(t => t.status === 'uploading' || t.status === 'queued');
    const [allFolders, setAllFolders] = useState<any[]>([]);
    const [uploadFolderId, setUploadFolderId] = useState<string | null>(null);

    const handlePickFile = async () => {
        setFabOpen(false);
        try {
            const res = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
            if (res.canceled) return;
            setPickedFiles(res.assets);
            setUploadFolderId(null);
            setUploadModal(true);
        } catch { showToast('Could not pick file', 'error'); }
    };

    const handleUpload = () => {
        if (!pickedFiles || pickedFiles.length === 0) return;
        setUploadModal(false);
        const fileAssets = pickedFiles.map(f => ({
            uri: f.uri,
            name: f.name,
            size: f.size ?? 0,
            mimeType: f.mimeType ?? 'application/octet-stream',
        }));
        addUpload(fileAssets, uploadFolderId, chatTarget);
        setPickedFiles([]);
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
    const totalBytes = stats.total_size || stats.totalBytes || 0;
    const usedGBNum = totalBytes / (1024 ** 3);
    const usedGB = usedGBNum.toFixed(2);
    const quotaGB = 5;
    const pct = Math.min((usedGBNum / quotaGB) * 100, 100);


    const displayItems = searchQuery ? searchResults : recentFiles;

    return (
        <SafeAreaView style={[s.root, { backgroundColor: C.bg }]}>

            {/* ── HEADER ───────────────────────────────────────────────────── */}
            <View style={[s.header, { backgroundColor: C.bg }]}>
                {showSearch ? (
                    <View style={[s.searchBar, { backgroundColor: C.card }]}>
                        <Search color={C.muted} size={18} />
                        <TextInput
                            style={[s.searchInput, { color: C.text }]}
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
                        onRefresh={() => { setRefreshing(true); load(true); }} />
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
                                <HardDrive color="#fff" size={20} />
                            </View>
                            <View style={{ flex: 1, marginLeft: 12 }}>
                                <Text style={s.storageTitle}>Axya Space</Text>
                                <Text style={s.storageSubtitle}>Personal Cloud</Text>
                            </View>
                        </View>

                        {/* Size display */}
                        <View style={s.storageSizeRow}>
                            <Text style={s.storageBig}>{usedGB}</Text>
                            <Text style={s.storageGBLabel}>GB</Text>
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
                                <Text style={s.statStatText}>{stats.image_count || 0} Images</Text>
                            </View>
                            <View style={s.storageStat}>
                                <View style={[s.statDot, { backgroundColor: '#9333EA' }]} />
                                <Text style={s.statStatText}>{stats.video_count || 0} Videos</Text>
                            </View>
                            <View style={s.storageStat}>
                                <View style={[s.statDot, { backgroundColor: 'rgba(255,255,255,0.4)' }]} />
                                <Text style={s.statStatText}>{stats.totalFiles || 0} Files</Text>
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
                                        onPress={() => navigation.navigate('FilePreview', { files: [f], initialIndex: 0 })}
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
                                    style={[s.fileRow, { backgroundColor: C.card }]}
                                    activeOpacity={0.7}
                                    onPress={() => {
                                        if (isFolder) {
                                            navigation.navigate('FolderFiles', { folderId: item.id, folderName: item.name });
                                        } else {
                                            const idx = recentFiles.findIndex(f => f.id === item.id);
                                            navigation.navigate('FilePreview', {
                                                files: recentFiles,
                                                initialIndex: idx === -1 ? 0 : idx,
                                                file: item
                                            });
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
                                        <Text style={[s.fileName, { color: C.text }]} numberOfLines={1}>
                                            {item.name || item.file_name}
                                        </Text>
                                        <Text style={[s.fileMeta, { color: C.muted }]}>
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

                {/* ═══════════════════════════════════════════════════════════
                    RECENT ACTIVITY
                ═══════════════════════════════════════════════════════════ */}
                {!searchQuery && activity.length > 0 && (
                    <View style={{ marginTop: 32, paddingHorizontal: 20 }}>
                        <Text style={s.sectionLabel}>RECENT ACTIVITY</Text>
                        <View style={s.activityList}>
                            {activity.map((act, i) => (
                                <View key={act.id || i} style={[s.activityItem, { backgroundColor: C.card }]}>
                                    <View style={s.activityIcon}>
                                        <Activity color={C.primary} size={14} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[s.activityText, { color: C.text }]} numberOfLines={1}>
                                            <Text style={{ fontWeight: '700' }}>{user?.username || 'You'}</Text> {act.action.replace(/_/g, ' ')} {act.file_name || ''}
                                        </Text>
                                        <Text style={s.activityTime}>{formatDate(act.created_at)}</Text>
                                    </View>
                                </View>
                            ))}
                        </View>
                    </View>
                )}

                <View style={{ height: 140 }} />

            </ScrollView>

            {/* ═══════════════════════════════════════════════════════════════
                BOTTOM NAV
            ═══════════════════════════════════════════════════════════════ */}
            <View style={[s.navBar, { backgroundColor: C.card, borderTopColor: C.border }]}>
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
                    <View style={[s.sheet, { backgroundColor: C.card }]}>
                        <View style={s.sheetHandle} />
                        <Text style={[s.sheetTitle, { color: C.text }]}>Create New</Text>

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
                    <View style={[s.modalCard, { backgroundColor: C.card }]}>
                        <Text style={[s.modalTitle, { color: C.text }]}>📤 Upload File</Text>
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
                            <TouchableOpacity style={s.btnConfirm} onPress={handleUpload} disabled={globalUploading}>
                                <Text style={s.btnConfirmTxt}>{globalUploading ? 'Uploading…' : 'Upload'}</Text>
                            </TouchableOpacity>
                        </View>
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
                    <View style={[s.modalCard, { backgroundColor: C.card }]}>
                        <Text style={[s.modalTitle, { color: C.text }]}>📁 New Folder</Text>
                        <TextInput
                            style={[s.modalInput, { color: C.text, borderColor: C.border, backgroundColor: C.inputBg }]}
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
                    <View style={[s.modalCard, { backgroundColor: C.card }]}>
                        <Text style={[s.modalTitle, { color: C.text }]}>✏️ Rename Folder</Text>
                        <TextInput
                            style={[s.modalInput, { color: C.text, borderColor: C.border, backgroundColor: C.inputBg }]}
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
    root: { flex: 1, backgroundColor: CS.bg },

    /* Header */
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: Platform.OS === 'web' ? 44 : 26,
        paddingBottom: 16,
        backgroundColor: CS.bg,
    },
    avatar: {
        width: 46, height: 46, borderRadius: 23, backgroundColor: CS.primary,
        justifyContent: 'center', alignItems: 'center',
        shadowColor: CS.primary, shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
    },
    greeting: { fontSize: 18, fontWeight: '700', color: CS.text },
    subGreeting: { fontSize: 13, color: CS.muted, marginTop: 2 },
    headerIconBtn: {
        width: 46, height: 46, borderRadius: 23, backgroundColor: CS.card,
        justifyContent: 'center', alignItems: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
    },
    searchBar: {
        flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: CS.card, borderRadius: 23, paddingHorizontal: 16, height: 48,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
    },
    searchInput: { flex: 1, fontSize: 15, color: CS.text },

    scrollContent: { paddingTop: 4, paddingBottom: 20 },

    /* Storage Card */
    storageCard: {
        marginHorizontal: 20,
        borderRadius: 24,
        backgroundColor: CS.primary,
        padding: 22,
        marginTop: 4,
        marginBottom: 32,
        shadowColor: CS.primary,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.4,
        shadowRadius: 20,
        elevation: 12,
    },
    storageTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
    storageIconBox: {
        width: 44, height: 44, borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center', alignItems: 'center',
    },
    storageTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
    storageSubtitle: { color: '#fff', fontSize: 13, opacity: 0.7, marginTop: 2 },
    storageSizeRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 14, gap: 4, marginBottom: 14 },
    storageGBLabel: { color: '#fff', fontSize: 13, fontWeight: '700', marginLeft: 2, marginRight: 8, opacity: 0.8 },
    upgradeBadge: { backgroundColor: 'rgba(255,255,255,0.25)', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 },
    upgradeText: { color: '#fff', fontSize: 13, fontWeight: '700' },
    storageBig: { fontSize: 34, fontWeight: '800', color: '#fff', letterSpacing: -0.5 },
    storageOf: { fontSize: 16, color: 'rgba(255,255,255,0.6)', marginLeft: 6, fontWeight: '500' },
    progressTrack: {
        height: 6, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 3, marginBottom: 16,
    },
    progressFill: { height: 6, backgroundColor: CS.accent, borderRadius: 3 },
    storageStats: { flexDirection: 'row', gap: 20 },
    storageStat: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    statDot: { width: 8, height: 8, borderRadius: 4 },
    statStatText: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '500' },

    /* Section headers */
    sectionRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20,
        marginBottom: 16,
    },
    sectionLabel: { fontSize: 12, fontWeight: '700', color: CS.muted, letterSpacing: 1.2 },
    seeAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    seeAllText: { fontSize: 13, fontWeight: '600', color: CS.primary },

    /* Folders - 2 column GRID */
    folderGrid: {
        flexDirection: 'row', flexWrap: 'wrap', gap: 14,
        paddingHorizontal: 20, marginBottom: 28,
    },
    folderGridCard: {
        width: '47%', borderRadius: 20, padding: 18,
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
    folderGridMeta: { fontSize: 12, color: CS.muted, fontWeight: '500' },
    folderAddCard: {
        backgroundColor: CS.card, borderWidth: 1.5, borderColor: CS.border,
        borderStyle: 'dashed', elevation: 0, shadowOpacity: 0,
        alignItems: 'center', justifyContent: 'center',
    },
    folderAddIcon: {
        width: 48, height: 48, borderRadius: 14,
        backgroundColor: '#EEF1FD', justifyContent: 'center', alignItems: 'center',
        marginBottom: 10,
    },

    emptyFolder: {
        marginHorizontal: 20, height: 64, backgroundColor: CS.card, borderRadius: 16,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        borderWidth: 1.5, borderColor: CS.border, borderStyle: 'dashed', marginBottom: 8,
    },
    emptyFolderText: { fontSize: 14, fontWeight: '600', color: CS.primary },

    /* File list */
    fileList: { paddingHorizontal: 20, gap: 4 },
    fileRow: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: CS.card,
        paddingVertical: 14, paddingHorizontal: 16, borderRadius: 18,
        marginBottom: 10,
        shadowColor: '#96A0B5', shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.08, shadowRadius: 10, elevation: 2,
    },
    fileIcon: {
        width: 46, height: 46, borderRadius: 14,
        justifyContent: 'center', alignItems: 'center',
    },
    fileInfo: { flex: 1, marginHorizontal: 14 },
    fileName: { fontSize: 14, fontWeight: '600', color: CS.text, marginBottom: 4 },
    fileMeta: { fontSize: 12, color: CS.muted, fontWeight: '500' },

    /* Empty state */
    emptyFiles: { alignItems: 'center', paddingTop: 40, paddingBottom: 32 },
    emptyFilesIcon: {
        width: 76, height: 76, borderRadius: 24,
        backgroundColor: CS.card, justifyContent: 'center', alignItems: 'center',
        marginBottom: 18,
        shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
    },
    emptyTitle: { fontSize: 17, fontWeight: '700', color: CS.text, marginBottom: 8 },
    emptyBody: { fontSize: 14, color: CS.muted, textAlign: 'center', lineHeight: 20 },

    /* Bottom nav */
    navBar: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: 86,
        backgroundColor: CS.card,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
        paddingBottom: 14,
        paddingHorizontal: 8,
        borderTopWidth: 1, borderTopColor: CS.border,
        shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.06, shadowRadius: 12, elevation: 12,
    },
    navItem: { alignItems: 'center', gap: 5, flex: 1 },
    navLabel: { fontSize: 11, fontWeight: '600', color: CS.muted },
    fab: {
        width: 60, height: 60, borderRadius: 30, backgroundColor: CS.primary,
        justifyContent: 'center', alignItems: 'center',
        shadowColor: CS.primary, shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.45, shadowRadius: 14, elevation: 10,
        marginTop: -20,
    },

    /* Modals / Sheets */
    overlay: { flex: 1, backgroundColor: 'rgba(10,10,30,0.45)', justifyContent: 'flex-end' },
    sheet: {
        backgroundColor: CS.card, borderTopLeftRadius: 28, borderTopRightRadius: 28,
        padding: 28, paddingBottom: 48,
    },
    sheetHandle: {
        width: 40, height: 4, backgroundColor: CS.border,
        borderRadius: 2, alignSelf: 'center', marginBottom: 24,
    },
    sheetTitle: { fontSize: 20, fontWeight: '700', color: CS.text, marginBottom: 24 },
    sheetRow: {
        flexDirection: 'row', alignItems: 'center', gap: 16,
        paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: CS.border,
    },
    sheetRowIcon: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
    sheetRowTitle: { fontSize: 16, fontWeight: '600', color: CS.text, marginBottom: 2 },
    sheetRowSub: { fontSize: 12, color: CS.muted },

    centeredOverlay: {
        flex: 1, backgroundColor: 'rgba(10,10,30,0.45)',
        justifyContent: 'center', alignItems: 'center', padding: 24,
    },
    modalCard: {
        width: '100%', backgroundColor: CS.card, borderRadius: 24, padding: 24,
        shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 24, elevation: 16,
    },
    modalTitle: { fontSize: 20, fontWeight: '700', color: CS.text, marginBottom: 16 },
    filePill: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: '#EEF1FD', borderRadius: 12, paddingHorizontal: 14,
        paddingVertical: 10, marginBottom: 20,
    },
    filePillText: { flex: 1, fontSize: 14, fontWeight: '600', color: CS.primary },
    modalLabel: { fontSize: 12, fontWeight: '600', color: CS.muted, marginBottom: 8, letterSpacing: 0.5 },
    modalInput: {
        borderWidth: 1.5, borderColor: CS.border, borderRadius: 14,
        paddingHorizontal: 16, height: 50, fontSize: 15, color: CS.text, marginBottom: 24,
        backgroundColor: CS.bg,
    },
    folderChip: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: CS.bg,
        borderWidth: 1.5,
        borderColor: CS.border,
        borderRadius: 20,
        marginRight: 10,
    },
    folderChipSelected: {
        backgroundColor: '#EEF1FD',
        borderColor: CS.primary,
    },
    folderChipText: {
        fontSize: 14,
        color: CS.muted,
        fontWeight: '600',
    },
    folderChipTextSelected: {
        color: CS.primary,
    },
    modalBtns: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end' },
    btnCancel: {
        paddingHorizontal: 20, paddingVertical: 13, borderRadius: 12, backgroundColor: CS.bg,
    },
    btnCancelTxt: { fontWeight: '600', color: CS.text, fontSize: 14 },
    btnConfirm: {
        paddingHorizontal: 24, paddingVertical: 13, borderRadius: 12, backgroundColor: CS.primary,
        shadowColor: CS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
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
        fontSize: 11, fontWeight: '600', color: CS.text, textAlign: 'center',
    },

    // ACTIVITY LIST
    activityList: { marginTop: 12, gap: 12 },
    activityItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: '#fff',
        padding: 12,
        borderRadius: 16,
        shadowColor: 'rgba(0,0,0,0.05)',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 1,
        shadowRadius: 10,
        elevation: 1,
    },
    activityIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(75,110,245,0.08)', justifyContent: 'center', alignItems: 'center' },
    activityText: { fontSize: 13, color: CS.text },
    activityTime: { fontSize: 11, color: CS.muted, marginTop: 2 },
});



