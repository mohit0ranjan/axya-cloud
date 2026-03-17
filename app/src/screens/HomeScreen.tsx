import { Fragment, useState, useEffect, useContext, useCallback, useRef, useMemo } from 'react';
import {
    View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet,
    SafeAreaView, RefreshControl, Platform, Modal, KeyboardAvoidingView,
    Dimensions, Animated, Easing, Image as RNImage,
} from 'react-native';
import {
    Search, Folder, Upload, HardDrive,
    User, X, FileText,
    MoreHorizontal
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { showActionSheet, showDestructiveConfirm } from '../utils/alert';


import * as DocumentPicker from 'expo-document-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient from '../services/apiClient';
import { AuthContext } from '../context/AuthContext';
import { useUpload } from '../context/UploadContext';
import { useApiCacheStore } from '../context/ApiCacheStore';
import { useToast } from '../context/ToastContext';
import { FileCardSkeleton, SkeletonBlock } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useTheme } from '../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';


import FileListItem from '../components/FileListItem';
import FileQuickActions from '../components/FileQuickActions';
import { useServerKeepAlive } from '../hooks/useServerKeepAlive';
import AppButton from '../components/AppButton';
import IconButton from '../components/IconButton';
import { formatFolderMeta } from '../utils/folderMeta';
import { useFileRefresh, useOptimisticFiles } from '../utils/events';
import { dedupeFilesById, sortFilesLatestFirst, syncAfterFileMutation } from '../services/fileStateSync';

const { width } = Dimensions.get('window');
const HOME_RECENT_FILES_PREVIEW_LIMIT = 3;
const HOME_TOTAL_FOLDER_CARDS_LIMIT = 4; // includes "All Files" card
const HOME_USER_FOLDER_PREVIEW_LIMIT = Math.max(0, HOME_TOTAL_FOLDER_CARDS_LIMIT - 1);
const HOME_PINNED_FOLDERS_KEY = '@home_pinned_folder_ids_v1';

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

const asArray = <T,>(value: any): T[] => (Array.isArray(value) ? value : []);

const createStyles = (C: Record<string, string>) => StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },

    /* Header */
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 20,
        backgroundColor: C.bg,
    },
    cloudIconContainer: {
        width: 44, height: 44, borderRadius: 12, backgroundColor: C.primarySoft,
        justifyContent: 'center', alignItems: 'center', marginRight: 12,
        shadowColor: C.primary, shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15, shadowRadius: 6, elevation: 4,
    },
    greeting: { fontSize: 20, fontWeight: '700', color: C.text, letterSpacing: -0.5 },
    subGreeting: { fontSize: 13, color: C.muted, marginTop: 2, fontWeight: '500' },
    headerIconBtn: {
        width: 44, height: 44, borderRadius: 22, backgroundColor: C.card,
        justifyContent: 'center', alignItems: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05, shadowRadius: 10, elevation: 4,
    },
    avatar: {
        width: 44, height: 44, borderRadius: 22, backgroundColor: '#5B7CFF',
        justifyContent: 'center', alignItems: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05, shadowRadius: 10, elevation: 4,
    },
    searchBar: {
        flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: C.card, borderRadius: 24, paddingHorizontal: 16, height: 48,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.03, shadowRadius: 6, elevation: 2,
    },
    searchInput: { flex: 1, fontSize: 15, color: C.text },

    scrollContent: { paddingTop: 4, paddingBottom: 20 },

    /* Storage Card (Premium Gradient Hero) */
    storageCardContainer: {
        marginHorizontal: 20,
        borderRadius: 32,
        marginTop: 4,
        marginBottom: 24,
        shadowColor: '#6366F1',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
        elevation: 14,
    },
    storageCard: {
        borderRadius: 32,
        paddingTop: 28,
        paddingBottom: 28,
        paddingHorizontal: 28,
        overflow: 'hidden',
    },
    meshBlob1: {
        position: 'absolute', top: -30, right: -30, width: 140, height: 140,
        borderRadius: 70, backgroundColor: 'rgba(255,255,255,0.1)',
    },
    meshBlob2: {
        position: 'absolute', bottom: -50, left: -50, width: 220, height: 220,
        borderRadius: 110, backgroundColor: 'rgba(255,255,255,0.05)',
    },
    storageTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
    storageTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
    storageSubtitle: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 4, fontWeight: '300' },
    storageIconWrapper: {
        width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center', alignItems: 'center',
    },
    storageSizeRow: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 20 },
    storageBig: { fontSize: 36, fontWeight: '700', color: '#fff', letterSpacing: -1 },
    storageGBLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 16, fontWeight: '600', marginLeft: 6 },
    storageOf: { color: '#fff', fontSize: 32, fontWeight: '400', marginLeft: 8 },
    progressTrack: {
        height: 6, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 3, marginBottom: 24,
    },
    progressFillWrap: { height: 6, borderRadius: 3, overflow: 'hidden' },
    progressFill: { flex: 1, backgroundColor: '#4ADE80' },
    storagePillsRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
    storagePill: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
    },
    storagePillDot: { width: 8, height: 8, borderRadius: 4 },
    storagePillText: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },

    /* Section headers */
    sectionRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20,
        marginBottom: 16,
    },
    sectionLabel: { fontSize: 12, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
    seeAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    seeAllText: { fontSize: 12, fontWeight: '600', color: C.muted },

    /* Folders - Modern Glass Cards */
    folderGrid: {
        flexDirection: 'row', flexWrap: 'wrap', gap: 16,
        paddingHorizontal: 20, marginBottom: 32,
    },
    folderGridCard: {
        width: '47%', borderRadius: 24, padding: 20,
        minHeight: 140,
        justifyContent: 'space-between',
        backgroundColor: C.card,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
    },
    folderGridTop: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    },
    folderIconBox: {
        width: 44, height: 44, borderRadius: 14,
        justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg,
    },
    folderGridName: { fontSize: 16, fontWeight: '600', marginBottom: 4, marginTop: 16, color: C.text, letterSpacing: -0.2 },
    folderGridMeta: { fontSize: 12, color: C.muted, fontWeight: '300' },
    
    emptyFolder: {
        marginHorizontal: 20, height: 80, backgroundColor: C.card, borderRadius: 24,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
        borderWidth: 1.5, borderColor: C.border, borderStyle: 'dashed', marginBottom: 20,
    },
    emptyFolderText: { fontSize: 14, fontWeight: '600', color: C.primary },

    /* File list */
    fileList: { paddingHorizontal: 0, gap: 8, paddingBottom: 48 },
    fileRow: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: C.card,
        paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.04, shadowRadius: 10, elevation: 2,
    },
    fileIcon: {
        width: 44, height: 44, borderRadius: 14,
        justifyContent: 'center', alignItems: 'center',
    },
    fileInfo: { flex: 1, marginHorizontal: 14 },
    fileName: { fontSize: 14, fontWeight: '600', color: C.text, marginBottom: 4 },
    fileMeta: { fontSize: 12, color: C.muted, fontWeight: '300' },

    /* Empty state */
    emptyFiles: { alignItems: 'center', paddingTop: 40, paddingBottom: 32 },
    emptyFilesIcon: {
        width: 76, height: 76, borderRadius: 24,
        backgroundColor: C.card, justifyContent: 'center', alignItems: 'center',
        marginBottom: 18,
        shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 10, elevation: 2,
    },
    emptyTitle: { fontSize: 17, fontWeight: '600', color: C.text, marginBottom: 8 },
    emptyBody: { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 20 },

    /* Bottom nav */
    navBar: {
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: 86,
        backgroundColor: '#FFFFFF',
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
        paddingBottom: 14,
        paddingHorizontal: 8,
        borderTopWidth: 1, borderTopColor: '#F1F5F9',
        shadowColor: '#000', shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.04, shadowRadius: 16, elevation: 12,
    },
    navItem: { alignItems: 'center', gap: 5, flex: 1 },
    navLabel: { fontSize: 11, fontWeight: '600', color: '#64748B' },
    fab: {
        width: 56, height: 56, borderRadius: 28, backgroundColor: '#5B7CFF',
        justifyContent: 'center', alignItems: 'center',
        shadowColor: '#5B7CFF', shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.4, shadowRadius: 12, elevation: 10,
        marginTop: -20,
    },

    /* Modals / Sheets */
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
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
    sheetRowIcon: { width: 48, height: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
    sheetRowTitle: { fontSize: 16, fontWeight: '600', color: C.text, marginBottom: 2 },
    sheetRowSub: { fontSize: 13, color: C.muted },

    centeredOverlay: {
        flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'center', alignItems: 'center', padding: 24,
    },
    modalCard: {
        width: '100%', backgroundColor: C.card, borderRadius: 28, padding: 24,
        shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 24, elevation: 16,
    },
    modalTitle: { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 16 },
    filePill: {
        flexDirection: 'row', alignItems: 'center', gap: 10,
        backgroundColor: C.primarySoft, borderRadius: 16, paddingHorizontal: 16,
        paddingVertical: 12, marginBottom: 20,
    },
    filePillText: { flex: 1, fontSize: 14, fontWeight: '600', color: C.primary },
    modalLabel: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 8 },
    modalInput: {
        borderWidth: 1.5, borderColor: C.border, borderRadius: 16,
        paddingHorizontal: 16, height: 50, fontSize: 15, color: C.text, marginBottom: 24,
        backgroundColor: C.inputBg,
    },
    folderChip: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        backgroundColor: C.inputBg,
        borderWidth: 1.5,
        borderColor: C.border,
        borderRadius: 20,
        marginRight: 10,
    },
    folderChipSelected: {
        backgroundColor: C.primarySoft,
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
        paddingHorizontal: 20, paddingVertical: 13, borderRadius: 12, backgroundColor: C.border,
    },
    btnCancelTxt: { fontWeight: '600', color: C.text, fontSize: 14 },
    btnConfirm: {
        paddingHorizontal: 24, paddingVertical: 13, borderRadius: 12, backgroundColor: C.primary,
        shadowColor: C.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
    },
    btnConfirmTxt: { fontWeight: '600', color: '#fff', fontSize: 14 },
    
});

// ------------------------------------------------------------------------------
export default function HomeScreen({ navigation, route }: any) {
    const { logout, user, token } = useContext(AuthContext);
    const { showToast } = useToast();
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    useServerKeepAlive(); // ? keeps Render from sleeping every 10 minutes

    // Dynamic color tokens — react to dark/light mode (memoized to prevent style recalculation)
    const C = useMemo(() => ({
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
        storageGrad1: theme.colors.gradientStart,
        storageGrad2: theme.colors.gradientMid,
        storageGrad3: theme.colors.gradientEnd,
        storageImages: theme.colors.storageImages,
        storageVideos: theme.colors.storageVideos,
        storageFiles: theme.colors.storageFiles,
        inputBg: theme.colors.inputBg,
        primarySoft: isDark ? 'rgba(88,117,255,0.16)' : '#EEF1FD',
        warningSoft: isDark ? 'rgba(245,158,11,0.16)' : '#FEF3C7',
        warning: '#D97706',
        dangerSoft: isDark ? 'rgba(239,68,68,0.16)' : '#FEE2E2',
        tealSoft: isDark ? 'rgba(13,148,136,0.16)' : '#CCFBF1',
        purpleSoft: isDark ? 'rgba(147,51,234,0.16)' : '#F3E8FF',
        successSoft: isDark ? 'rgba(22,163,74,0.16)' : '#DCFCE7',
    }), [theme.colors, isDark]);

    // Memoized styles that react to theme changes
    const s = useMemo(() => createStyles(C), [C]);

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [stats, setStats] = useState<any>({});
    const [recentFiles, setRecentFiles] = useState<any[]>([]);
    const [folders, setFolders] = useState<any[]>([]);
    const [pinnedFolderIds, setPinnedFolderIds] = useState<string[]>([]);
    const [allFolders, setAllFolders] = useState<any[]>([]);
    const [uploadFolderId, setUploadFolderId] = useState<string | null>(null);


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
    const chatTarget = 'me';


    // Folder modal
    const [folderModal, setFolderModal] = useState(false);
    const [folderName, setFolderName] = useState('');
    const [isCreatingFolder, setIsCreatingFolder] = useState(false);

    // Rename folder modal
    const [renameFolderModal, setRenameFolderModal] = useState(false);
    const [renameFolderTarget, setRenameFolderTarget] = useState<any>(null);
    const [renameFolderName, setRenameFolderName] = useState('');
    const [isRenamingFolder, setIsRenamingFolder] = useState(false);
    const mountedRef = useRef(true);

    const { homeData, setHomeData } = useApiCacheStore();

    // Debounced search
    useEffect(() => {
        let isCancelled = false;
        const q = searchQuery.trim();
        if (!q) { setSearchResults([]); return; }
        const t = setTimeout(async () => {
            if (isCancelled) return;
            setSearching(true);
            try {
                const res = await apiClient.get(`/files/search?q=${encodeURIComponent(q)}`);
                if (!isCancelled && res.data.success) {
                    setSearchResults(res.data.results);
                }
            } catch {
                if (!isCancelled) setSearchResults([]);
            }
            finally {
                if (!isCancelled) setSearching(false);
            }
        }, 350);
        return () => {
            isCancelled = true;
            clearTimeout(t);
        };
    }, [searchQuery]);

    useEffect(() => {
        return () => {
            mountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (homeData) { // Instantiate instantly from cache to prevent empty screen flashes
            setStats(homeData.stats);
            setRecentFiles(sortFilesLatestFirst(dedupeFilesById(asArray(homeData.files))));
            setAllFolders(asArray(homeData.folders));
            setLoading(false);
        }
        void hydratePinnedFolderIds();
        load();
    }, []);

    useFileRefresh(() => {
        load(true);
    });

    useOptimisticFiles(setRecentFiles);

    useEffect(() => {
        if (!route?.params?.openFabAt) return;
        setFabOpen(true);
        navigation.setParams?.({ openFabAt: undefined });
    }, [route?.params?.openFabAt, navigation]);

    useEffect(() => {
        const unsubscribe = navigation?.addListener?.('focus', () => {
            void hydratePinnedFolderIds();
        });
        return unsubscribe;
    }, [navigation]);

    useEffect(() => {
        setFolders(buildHomeFolders(allFolders, pinnedFolderIds));
    }, [allFolders, pinnedFolderIds]);

    const load = async (isRefresh = false) => {
        if (!homeData && !isRefresh) setLoading(true);
        try {
            // ? Fix #14: stagger requests on cold start to avoid bursting Render
            // When cache exists user already sees data, so fire all in parallel (fast refresh)
            // When cache is empty (first load), stagger by 150ms each to not wake server with 5 simultaneous hits
            let statsRes, filesRes, foldersRes;

            if (homeData) {
                // Cache warm — parallel is fine, user already sees content
                [statsRes, filesRes, foldersRes] = await Promise.all([
                    apiClient.get('/files/stats'),
                    apiClient.get(`/files?limit=${HOME_RECENT_FILES_PREVIEW_LIMIT}&sort=created_at&order=DESC`),
                    apiClient.get('/files/folders'),
                ]);
            } else {
                // Cold start — stagger to avoid 5-request burst hitting Render wake-up
                const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
                statsRes = await apiClient.get('/files/stats');
                await delay(150);
                filesRes = await apiClient.get(`/files?limit=${HOME_RECENT_FILES_PREVIEW_LIMIT}&sort=created_at&order=DESC`);
                await delay(150);
                foldersRes = await apiClient.get('/files/folders');
            }

            const newStats = statsRes.data.success ? statsRes.data : {};
            const newFiles = filesRes.data.success
                ? sortFilesLatestFirst(dedupeFilesById(asArray(filesRes.data.files)))
                : [];
            const newFolders = foldersRes.data.success ? asArray(foldersRes.data.folders) : [];

            if (!mountedRef.current) return;
            setHomeData({ stats: newStats, files: newFiles, folders: newFolders, recent: [], activity: [] });
            setStats(newStats);
            setRecentFiles(newFiles);
            setAllFolders(newFolders);

        } catch (e) {
            if (mountedRef.current && !homeData) showToast('Could not load dashboard', 'error');
        } finally {
            if (mountedRef.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    };

    const { addUpload } = useUpload();

    const normalizeFolderId = (value: any) => String(value ?? '').trim();

    const buildHomeFolders = useCallback((sourceFolders: any[], pinnedIds: string[]) => {
        if (!Array.isArray(sourceFolders) || sourceFolders.length === 0) return [];
        const byId = new Map(sourceFolders.map((f) => [normalizeFolderId(f?.id), f]));
        const pinnedExisting = pinnedIds
            .map((id) => byId.get(id))
            .filter(Boolean) as any[];
        const pinnedSet = new Set(pinnedExisting.map((f) => normalizeFolderId(f?.id)));
        const fallback = sourceFolders.filter((f) => !pinnedSet.has(normalizeFolderId(f?.id)));
        return [...pinnedExisting, ...fallback].slice(0, HOME_USER_FOLDER_PREVIEW_LIMIT);
    }, []);

    const persistPinnedFolderIds = useCallback(async (ids: string[]) => {
        try {
            await AsyncStorage.setItem(HOME_PINNED_FOLDERS_KEY, JSON.stringify(ids));
        } catch {
            showToast('Could not save Home folders', 'error');
        }
    }, [showToast]);

    const hydratePinnedFolderIds = useCallback(async () => {
        try {
            const raw = await AsyncStorage.getItem(HOME_PINNED_FOLDERS_KEY);
            if (!raw) {
                setPinnedFolderIds([]);
                return;
            }
            const parsed = JSON.parse(raw);
            const next = Array.isArray(parsed)
                ? parsed.map((id: any) => normalizeFolderId(id)).filter(Boolean)
                : [];
            setPinnedFolderIds(next);
        } catch {
            setPinnedFolderIds([]);
        }
    }, []);

    const toggleFolderPinned = useCallback((folder: any) => {
        const id = normalizeFolderId(folder?.id);
        if (!id) return;
        const isPinned = pinnedFolderIds.includes(id);
        let nextIds: string[] = [];

        if (isPinned) {
            nextIds = pinnedFolderIds.filter((x) => x !== id);
            showToast('Removed from Home folders');
        } else {
            if (pinnedFolderIds.length >= HOME_USER_FOLDER_PREVIEW_LIMIT) {
                showToast(`Only ${HOME_USER_FOLDER_PREVIEW_LIMIT} folders can be pinned`, 'error');
                return;
            }
            nextIds = [...pinnedFolderIds, id];
            showToast('Pinned to Home folders');
        }

        setPinnedFolderIds(nextIds);
        void persistPinnedFolderIds(nextIds);
    }, [persistPinnedFolderIds, pinnedFolderIds, showToast]);

    // Memoized handler for file item press
    const handleFileItemPress = useCallback((item: any, isFolder: boolean) => {
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
    }, [navigation, recentFiles]);

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
        const fileAssets = pickedFiles
            .filter(f => !!f?.uri && !!f?.name)
            .map(f => ({
            uri: f.uri,
            name: f.name,
            size: f.size ?? 0,
            mimeType: f.mimeType ?? 'application/octet-stream',
        }));
        if (fileAssets.length === 0) {
            showToast('No valid files selected', 'error');
            return;
        }
        addUpload(fileAssets, uploadFolderId, chatTarget);
        setPickedFiles([]);
    };



    const handleCreateFolder = async () => {
        if (!folderName.trim() || isCreatingFolder) return;
        setIsCreatingFolder(true);
        try {
            const res = await apiClient.post('/files/folder', { name: folderName.trim() });
            if (res.data.success) {
                showToast('Folder created!');
                setFolderName('');
                setFolderModal(false);
                load();
                syncAfterFileMutation();
            }
        } catch (e: any) {
            showToast(e.response?.data?.error || 'Could not create folder', 'error');
        } finally {
            setIsCreatingFolder(false);
        }
    };

    const handleRenameFolder = async () => {
        if (!renameFolderName.trim() || !renameFolderTarget || isRenamingFolder) return;
        setIsRenamingFolder(true);
        try {
            const res = await apiClient.patch(`/files/folder/${renameFolderTarget.id}`, { name: renameFolderName.trim() });
            if (res.data.success) {
                showToast('Folder renamed!');
                setRenameFolderModal(false);
                setRenameFolderTarget(null);
                load();
                syncAfterFileMutation();
            }
        } catch (e: any) {
            showToast(e.response?.data?.error || 'Could not rename folder', 'error');
        } finally {
            setIsRenamingFolder(false);
        }
    };

    // Options Modal
    const [optionsTarget, setOptionsTarget] = useState<any>(null);

    // -- Storage card percentage (Unlimited Storage) --------------------------
    // Axya now supports unlimited storage - show usage without percentage bar
    const totalBytes = stats.total_size || stats.totalBytes || 0;
    const usedGBNum = totalBytes / (1024 ** 3);
    
    // For visual reference only - show usage level indicator (not a quota)
    // Green: < 5GB, Yellow: 5-20GB, Orange: 20-50GB, Red: > 50GB
    const getUsageColor = (gb: number) => {
        if (gb < 5) return C.success;
        if (gb < 20) return C.accent;
        if (gb < 50) return '#F97316';
        return C.danger;
    };
    const usageColor = getUsageColor(usedGBNum);
    const usageLevel = Math.min(92, Math.max(12, 12 + Math.log10(usedGBNum + 1) * 30));

    // Animated CountUp for GB
    const [animatedGB, setAnimatedGB] = useState('0.00');
    useEffect(() => {
        if (usedGBNum === 0) {
            setAnimatedGB('0.00');
            return;
        }
        let start = 0;
        const duration = 1000;
        const fps = 60;
        const steps = duration / (1000 / fps);
        const increment = usedGBNum / steps;

        let current = 0;
        const timer = setInterval(() => {
            current += increment;
            if (current >= usedGBNum) {
                setAnimatedGB(usedGBNum.toFixed(2));
                clearInterval(timer);
            } else {
                setAnimatedGB(current.toFixed(2));
            }
        }, 1000 / fps);
        return () => clearInterval(timer);
    }, [usedGBNum]);

    // Unlimited storage - no "unused" calculation needed

    const displayItems = useMemo(
        () => (searchQuery ? searchResults : recentFiles.slice(0, HOME_RECENT_FILES_PREVIEW_LIMIT)),
        [recentFiles, searchQuery, searchResults]
    );

    return (
        <SafeAreaView style={[s.root, { backgroundColor: C.bg }]}>

            {/* -- HEADER ----------------------------------------------------- */}
            <View style={[s.header, { paddingTop: Math.max(insets.top + 8, 16) }]}>
                {showSearch ? (
                    <View style={s.searchBar}>
                        <Search color="#64748B" size={18} />
                        <TextInput
                            style={s.searchInput}
                            placeholder="Search files & folders…"
                            placeholderTextColor="#64748B"
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            autoFocus
                        />
                        <IconButton
                            variant="ghost"
                            onPress={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]); }}
                            icon={<X color="#64748B" size={20} />}
                        />
                    </View>
                ) : (
                    <>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}>
                            <View style={s.cloudIconContainer}>
                                <RNImage
                                    source={require('../../assets/icon.png')}
                                    style={{ width: 28, height: 28, borderRadius: 7 }}
                                    resizeMode="contain"
                                />
                            </View>
                            <View>
                                <Text style={s.greeting}>Hello, {user?.name?.split(' ')[0] || user?.username || 'User'}</Text>
                                <Text style={s.subGreeting}>Welcome to Axya</Text>
                            </View>
                        </View>
                        <IconButton
                            variant="surface"
                            style={s.headerIconBtn}
                            onPress={() => setShowSearch(true)}
                            icon={<Search color="#111827" size={20} />}
                        />
                        <View style={{ width: 12 }} />
                        <IconButton
                            variant="primary"
                            style={s.avatar}
                            onPress={() => navigation.navigate('Profile')}
                            icon={<User color="#fff" size={20} />}
                        />
                    </>
                )}
            </View>

            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={s.scrollContent}
                refreshControl={
                    <RefreshControl refreshing={refreshing} tintColor="#5B7CFF"
                        onRefresh={() => { setRefreshing(true); load(true); }} />
                }
            >

                {/* -----------------------------------------------------------
                    STORAGE DASHBOARD CARD
                ----------------------------------------------------------- */}
                {!searchQuery && (
                    <View style={s.storageCardContainer}>
                        <LinearGradient
                            colors={[C.storageGrad1, C.storageGrad2, C.storageGrad3]}
                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                            style={s.storageCard}
                        >
                            <View style={s.meshBlob1} />
                            <View style={s.meshBlob2} />

                            <View style={s.storageTop}>
                                <View>
                                    <Text style={s.storageTitle}>Axya Space</Text>
                                    <Text style={s.storageSubtitle}>Personal Cloud Storage</Text>
                                </View>
                                <View style={s.storageIconWrapper}>
                                    <HardDrive color="#fff" size={20} />
                                </View>
                            </View>

                            <View style={s.storageSizeRow}>
                                <Text style={s.storageBig}>{animatedGB}</Text>
                                <Text style={s.storageGBLabel}>GB</Text>
                                <Text style={s.storageOf}>/ ∞</Text>
                            </View>

                            <View style={s.progressTrack}>
                                <View style={[s.progressFillWrap, { width: `${usageLevel}%` as any }]}>
                                    <View style={[s.progressFill, { backgroundColor: usageColor }]} />
                                </View>
                            </View>

                            <View style={s.storagePillsRow}>
                                <View style={s.storagePill}>
                                    <View style={[s.storagePillDot, { backgroundColor: C.storageImages }]} />
                                    <Text style={s.storagePillText} numberOfLines={1}>{stats.image_count || 0} IMAGES</Text>
                                </View>
                                <View style={s.storagePill}>
                                    <View style={[s.storagePillDot, { backgroundColor: C.storageVideos }]} />
                                    <Text style={s.storagePillText} numberOfLines={1}>{stats.video_count || 0} VIDEOS</Text>
                                </View>
                                <View style={s.storagePill}>
                                    <View style={[s.storagePillDot, { backgroundColor: C.storageFiles }]} />
                                    <Text style={s.storagePillText} numberOfLines={1}>{stats.totalFiles || 0} FILES</Text>
                                </View>
                            </View>
                        </LinearGradient>
                    </View>
                )}

                {/* -----------------------------------------------------------
                    FOLDERS SECTION
                ----------------------------------------------------------- */}
                {!searchQuery && (
                    <>
                        <View style={s.sectionRow}>
                            <Text style={s.sectionLabel}>FOLDERS</Text>
                            <TouchableOpacity style={s.seeAllBtn} onPress={() => navigation.navigate('Folders')}>
                                <Text style={s.seeAllText}>See all</Text>
                                <MoreHorizontal color="#64748B" size={14} />
                            </TouchableOpacity>
                        </View>

                        {loading ? (
                            <View style={s.folderGrid}>
                                {[1, 2, 3, 4].map(i => (
                                    <View key={`folder-skel-${i}`} style={s.folderGridCard}>
                                        <SkeletonBlock width={44} height={44} borderRadius={12} />
                                        <SkeletonBlock width="70%" height={13} borderRadius={6} style={{ marginTop: 28 }} />
                                        <SkeletonBlock width="50%" height={11} borderRadius={5} style={{ marginTop: 6 }} />
                                    </View>
                                ))}
                            </View>
                        ) : folders.length === 0 ? (
                            <TouchableOpacity style={s.emptyFolder} onPress={() => { setFabOpen(false); setFolderModal(true); }}>
                                <Folder color={C.primary} size={22} />
                                <Text style={s.emptyFolderText}>Create your first folder</Text>
                            </TouchableOpacity>
                        ) : (
                            <View style={s.folderGrid}>
                                <TouchableOpacity style={s.folderGridCard} onPress={() => navigation.navigate('AllFiles')}>
                                    <View style={s.folderGridTop}>
                                        <View style={[s.folderIconBox, { backgroundColor: C.bg }]}>
                                            <Folder color="#2563EB" size={24} fill="#2563EB" />
                                        </View>
                                        <IconButton
                                            variant="ghost"
                                            size={36}
                                            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'transparent' }}
                                            onPress={() => {}}
                                            icon={<MoreHorizontal color="#94A3B8" size={18} />}
                                        />
                                    </View>
                                    <View>
                                        <Text style={s.folderGridName} numberOfLines={1}>All Files</Text>
                                        <Text style={s.folderGridMeta}>Folder</Text>
                                    </View>
                                </TouchableOpacity>
                                {folders.map((folder, idx) => {
                                    // Soft pastel colors matching the design image theme
                                    const FOLDER_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#F43F5E', '#8B5CF6'];
                                    const rawColor = FOLDER_COLORS[idx % FOLDER_COLORS.length];
                                    const iconBg = `${rawColor}15`;

                                    return (
                                        <TouchableOpacity
                                            key={folder.id}
                                            style={s.folderGridCard}
                                            activeOpacity={0.7}
                                            onPress={() => navigation.navigate('FolderFiles', { folderId: folder.id, folderName: folder.name })}
                                        >
                                            <View style={s.folderGridTop}>
                                                <View style={[s.folderIconBox, { backgroundColor: iconBg }]}>
                                                    <Folder color={rawColor} size={24} fill={rawColor} />
                                                </View>
                                                <IconButton
                                                    variant="ghost"
                                                    size={36}
                                                    style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'transparent' }}
                                                    onPress={() => {
                                                        if (Platform.OS === 'web') {
                                                            setOptionsTarget(folder);
                                                        } else {
                                                            showActionSheet(
                                                                "Folder Options",
                                                                `Manage "${folder.name}"`,
                                                                [
                                                                    {
                                                                        text: pinnedFolderIds.includes(normalizeFolderId(folder.id))
                                                                            ? "Remove from Home"
                                                                            : "Pin to Home",
                                                                        onPress: () => toggleFolderPinned(folder)
                                                                    },
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
                                                                        destructive: true,
                                                                        onPress: async () => {
                                                                            try {
                                                                                const res = await apiClient.delete(`/files/folder/${folder.id}`);
                                                                                if (res.data.success) {
                                                                                    showToast('Folder moved to trash');
                                                                                    load();
                                                                                    syncAfterFileMutation();
                                                                                }
                                                                            } catch (e: any) {
                                                                                showToast(e.response?.data?.error || 'Could not delete folder', 'error');
                                                                            }
                                                                        }
                                                                    }
                                                                ]
                                                            );
                                                        }
                                                    }}
                                                    icon={<MoreHorizontal color="#94A3B8" size={18} opacity={1} />}
                                                />
                                            </View>
                                            <View>
                                                <Text style={s.folderGridName} numberOfLines={1}>
                                                    {folder.name}
                                                </Text>
                                                <Text style={s.folderGridMeta}>
                                                    {formatFolderMeta(folder)} files
                                                </Text>
                                            </View>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        )}
                    </>
                )}

                {/* -----------------------------------------------------------
                    RECENT FILES
                ----------------------------------------------------------- */}
                <View style={[s.sectionRow, { marginTop: searchQuery ? 0 : 8 }]}>
                    <Text style={s.sectionLabel}>
                        {searchQuery ? `RESULTS FOR "${searchQuery.toUpperCase()}"` : 'RECENT FILES'}
                    </Text>
                    {!searchQuery && (
                        <TouchableOpacity style={s.seeAllBtn} onPress={() => navigation.navigate('AllFiles')}>
                            <Text style={s.seeAllText}>See all</Text>
                            <MoreHorizontal color="#64748B" size={14} />
                        </TouchableOpacity>
                    )}
                </View>

                {loading || searching ? (
                    <View style={{ paddingHorizontal: 20 }}>
                        {[1, 2, 3, 4].map(i => <FileCardSkeleton key={i} />)}
                    </View>
                ) : displayItems.length === 0 ? (
                    <EmptyState
                        title={searchQuery ? 'No results found' : 'No files yet'}
                        description={searchQuery ? 'Try a different keyword' : 'Upload a file to get started'}
                        iconType={searchQuery ? 'search' : 'file'}
                        style={{ paddingVertical: 40, flex: 0 }}
                    />
                ) : (
                    <View style={s.fileList}>
                        {displayItems.map((item: any) => (
                            <FileListItem
                                key={item.id}
                                item={item}
                                variant="card"
                                token={token}
                                apiBaseUrl={apiClient.defaults.baseURL || ''}
                                theme={theme}
                                isDark={isDark}
                                onPress={(item) => handleFileItemPress(item, false)}
                                onOptionsPress={(item) => setOptionsTarget(item)}
                            />
                        ))}
                    </View>
                )}

                <View style={{ height: 20 }} />

            </ScrollView>

            {/* ---------------------------------------------------------------
                FAB ACTION SHEET
            --------------------------------------------------------------- */}
            <Modal visible={fabOpen} transparent animationType="slide">
                <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setFabOpen(false)}>
                    <View style={[s.sheet, { backgroundColor: C.card }]}>
                        <View style={s.sheetHandle} />
                        <Text style={[s.sheetTitle, { color: C.text }]}>Create New</Text>

                        <TouchableOpacity style={s.sheetRow} onPress={handlePickFile} activeOpacity={0.7}>
                            <View style={[s.sheetRowIcon, { backgroundColor: C.primarySoft }]}>
                                <Upload color={C.primary} size={22} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={s.sheetRowTitle}>Upload File</Text>
                                <Text style={s.sheetRowSub}>Pick any file from your device</Text>
                            </View>
                            <MoreHorizontal color={C.muted} size={18} />
                        </TouchableOpacity>

                        <TouchableOpacity style={s.sheetRow}
                            onPress={() => { setFabOpen(false); setFolderModal(true); }} activeOpacity={0.7}>
                            <View style={[s.sheetRowIcon, { backgroundColor: C.warningSoft }]}>
                                <Folder color={C.warning} size={22} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={s.sheetRowTitle}>New Folder</Text>
                                <Text style={s.sheetRowSub}>Organise your files</Text>
                            </View>
                            <MoreHorizontal color={C.muted} size={18} />
                        </TouchableOpacity>
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* ---------------------------------------------------------------
                UPLOAD CONFIRM MODAL
            --------------------------------------------------------------- */}
            <Modal visible={uploadModal} transparent animationType="fade">
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={s.centeredOverlay}>
                    <View style={[s.modalCard, { backgroundColor: C.card }]}>
                        <Text style={[s.modalTitle, { color: C.text }]}>Upload File</Text>
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
                            <AppButton
                                label="Cancel"
                                variant="secondary"
                                onPress={() => { setUploadModal(false); setPickedFiles([]); }}
                            />
                            <AppButton
                                label="Upload"
                                onPress={handleUpload}
                                disabled={pickedFiles.length === 0}
                            />
                        </View>
                    </View>

                </KeyboardAvoidingView>
            </Modal>

            {/* ---------------------------------------------------------------
                NEW FOLDER MODAL
            --------------------------------------------------------------- */}
            <Modal visible={folderModal} transparent animationType="fade">
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={s.centeredOverlay}>
                    <View style={[s.modalCard, { backgroundColor: C.card }]}>
                        <Text style={[s.modalTitle, { color: C.text }]}>New Folder</Text>
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
                            <AppButton
                                label="Cancel"
                                variant="secondary"
                                onPress={() => { setFolderModal(false); setFolderName(''); }}
                            />
                            <AppButton
                                label="Create"
                                onPress={handleCreateFolder}
                                loading={isCreatingFolder}
                                disabled={!folderName.trim() || isCreatingFolder}
                            />
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* -- Rename Folder Modal --------------------------------- */}
            <Modal visible={renameFolderModal} transparent animationType="fade">
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={s.centeredOverlay}>
                    <View style={[s.modalCard, { backgroundColor: C.card }]}>
                        <Text style={[s.modalTitle, { color: C.text }]}>Rename Folder</Text>
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
                            <AppButton
                                label="Cancel"
                                variant="secondary"
                                onPress={() => { setRenameFolderModal(false); setRenameFolderTarget(null); }}
                            />
                            <AppButton
                                label="Rename"
                                onPress={handleRenameFolder}
                                loading={isRenamingFolder}
                                disabled={!renameFolderName.trim() || isRenamingFolder}
                            />
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* -- Folder Options Modal -- */}
            {(optionsTarget?.result_type === 'folder' || optionsTarget?.mime_type === 'inode/directory') && (
            <Modal visible={true} transparent animationType="slide">
                <TouchableOpacity
                    style={s.overlay}
                    activeOpacity={1}
                    onPress={() => setOptionsTarget(null)}
                >
                    <View style={[s.sheet, { backgroundColor: C.card }]}>
                        <View style={s.sheetHandle} />
                        <Text style={[s.sheetTitle, { color: C.text }]}>Manage "{optionsTarget?.name}"</Text>

                        <TouchableOpacity style={s.sheetRow} onPress={() => { setOptionsTarget(null); toggleFolderPinned(optionsTarget); }}>
                            <Text style={s.sheetRowTitle}>{pinnedFolderIds.includes(normalizeFolderId(optionsTarget?.id)) ? 'Remove from Home' : 'Pin to Home'}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={s.sheetRow} onPress={() => { setOptionsTarget(null); setRenameFolderTarget(optionsTarget); setRenameFolderName(optionsTarget?.name); setRenameFolderModal(true); }}>
                            <Text style={s.sheetRowTitle}>Rename Folder</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={[s.sheetRow, { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 16, marginTop: 12 }]} onPress={async () => {
                            const targetId = optionsTarget?.id;
                            const targetName = optionsTarget?.name;
                            setOptionsTarget(null);
                            const confirmed = await showDestructiveConfirm('Delete Folder', `Move "${targetName}" to trash?`, 'Delete');
                            if (confirmed) {
                                try {
                                    const res = await apiClient.delete(`/files/folder/${targetId}`);
                                    if (res.data.success) {
                                        showToast('Folder moved to trash');
                                        load();
                                        syncAfterFileMutation();
                                    }
                                } catch (e: any) {
                                    showToast(e.response?.data?.error || 'Could not delete folder', 'error');
                                }
                            }
                        }}>
                            <Text style={[s.sheetRowTitle, { color: 'red', fontWeight: 'bold' }]}>Delete Folder</Text>
                        </TouchableOpacity>
                        <View style={{ height: 24 }} />
                    </View>
                </TouchableOpacity>
            </Modal>
            )}

            {/* -- File Quick Actions -- */}
            {optionsTarget && !(optionsTarget.result_type === 'folder' || optionsTarget.mime_type === 'inode/directory') && (
                <FileQuickActions 
                    item={optionsTarget} 
                    visible={true} 
                    onClose={() => setOptionsTarget(null)} 
                    onRefresh={() => load(true)} 
                />
            )}

        </SafeAreaView>
    );
}






