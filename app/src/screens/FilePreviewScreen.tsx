import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
    Dimensions, Platform, FlatList, ViewToken, Modal, TextInput,
    Alert, KeyboardAvoidingView, Vibration
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    ArrowLeft, Download, Star, Share2, MoreHorizontal,
    FolderInput, Trash2, Pencil,
    FileText, X, Image as ImageIcon, ChevronLeft, ChevronRight
} from 'lucide-react-native';
import { Image } from '../components/AppImage';
import VideoPlayer from '../components/VideoPlayer';
import PreviewSkeleton from '../components/PreviewSkeleton';
import ShareFolderModal from '../components/ShareFolderModal';
import { WebView } from 'react-native-webview';

import apiClient, { API_BASE } from '../services/apiClient';
import { useToast } from '../context/ToastContext';
import { useDownload } from '../context/DownloadContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { syncAfterFileMutation } from '../services/fileStateSync';
import { emitFileDeleted, emitFileUpdated } from '../utils/events';
import { buildApiFileUrl, sanitizeDisplayName, sanitizeFileName } from '../utils/fileSafety';

import Animated, {
    useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS, FadeIn, FadeOut
} from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';

const { width, height } = Dimensions.get('window');

// --------------------------------------------------------------------------
// Gestures & Preview Item
// --------------------------------------------------------------------------

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const IMG_H = height * 0.55; 
const SPRING_CFG = { damping: 20, stiffness: 200 };

function ImagePreviewItem({ item, jwt, isZoomed, onZoomChange, onSingleTap, CARD_BG }: any) {
    const [loading, setLoading] = useState(true);
    const [useFallback, setUseFallback] = useState(false);
    const [previewFailed, setPreviewFailed] = useState(false);
    
    // File URLs
    const thumbUrl = buildApiFileUrl(API_BASE, item.id, 'thumbnail');
    const downloadUrl = buildApiFileUrl(API_BASE, item.id, 'download');
    const headers = useMemo(() => ({ Authorization: `Bearer ${jwt}` }), [jwt]);
    const imageSource = useMemo(() => ({ uri: useFallback ? downloadUrl : thumbUrl, headers }), [downloadUrl, headers, thumbUrl, useFallback]);

    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const savedTransX = useSharedValue(0);
    const savedTransY = useSharedValue(0);
    const imageOpacity = useSharedValue(0);

    useEffect(() => {
        setLoading(true); setUseFallback(false); setPreviewFailed(false);
        scale.value = 1; savedScale.value = 1;
        translateX.value = 0; translateY.value = 0;
        savedTransX.value = 0; savedTransY.value = 0;
        imageOpacity.value = 0;
        onZoomChange?.(false);
    }, [item?.id, onZoomChange]);

    const pinch = Gesture.Pinch()
        .enabled(Platform.OS !== 'web')
        .onUpdate(e => {
            'worklet';
            scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, savedScale.value * e.scale));
            if (onZoomChange) runOnJS(onZoomChange)(scale.value > 1.02);
        })
        .onEnd(() => {
            'worklet';
            if (scale.value < 1.05) {
                scale.value = withSpring(1, SPRING_CFG);
                translateX.value = withSpring(0, SPRING_CFG);
                translateY.value = withSpring(0, SPRING_CFG);
                savedScale.value = 1;
                savedTransX.value = 0; savedTransY.value = 0;
            } else {
                savedScale.value = scale.value;
                const maxX = (width * (scale.value - 1)) / 2;
                const maxY = (IMG_H * (scale.value - 1)) / 2;
                const cx = Math.max(-maxX, Math.min(maxX, translateX.value));
                const cy = Math.max(-maxY, Math.min(maxY, translateY.value));
                translateX.value = cx; translateY.value = cy;
                savedTransX.value = cx; savedTransY.value = cy;
            }
            if (onZoomChange) runOnJS(onZoomChange)(scale.value > 1.05);
        });

    const pan = Gesture.Pan()
        .enabled(Platform.OS !== 'web' && isZoomed)
        .averageTouches(true)
        .activeOffsetX([-10, 10])
        .activeOffsetY([-10, 10])
        .onUpdate(e => {
            'worklet';
            if (scale.value <= 1.02) return;
            const maxX = (width * (scale.value - 1)) / 2;
            const maxY = (IMG_H * (scale.value - 1)) / 2;
            translateX.value = Math.max(-maxX, Math.min(maxX, savedTransX.value + e.translationX));
            translateY.value = Math.max(-maxY, Math.min(maxY, savedTransY.value + e.translationY));
        })
        .onEnd(() => {
            'worklet';
            savedTransX.value = translateX.value;
            savedTransY.value = translateY.value;
        });

    const doubleTap = Gesture.Tap()
        .numberOfTaps(2)
        .maxDelay(250)
        .onEnd(e => {
            'worklet';
            if (scale.value <= 1.02) {
                const targetScale = 2.5;
                const maxX = (width * (targetScale - 1)) / 2;
                const maxY = (IMG_H * (targetScale - 1)) / 2;
                const dx = (e.x - width / 2) * -0.35;
                const dy = (e.y - IMG_H / 2) * -0.35;
                const tx = Math.max(-maxX, Math.min(maxX, dx));
                const ty = Math.max(-maxY, Math.min(maxY, dy));
                scale.value = withSpring(targetScale, SPRING_CFG);
                translateX.value = withSpring(tx, SPRING_CFG);
                translateY.value = withSpring(ty, SPRING_CFG);
                savedScale.value = targetScale;
                savedTransX.value = tx; savedTransY.value = ty;
                if (onZoomChange) runOnJS(onZoomChange)(true);
                return;
            }
            scale.value = withSpring(1, SPRING_CFG);
            translateX.value = withSpring(0, SPRING_CFG);
            translateY.value = withSpring(0, SPRING_CFG);
            savedScale.value = 1; savedTransX.value = 0; savedTransY.value = 0;
            if (onZoomChange) runOnJS(onZoomChange)(false);
        });

    const singleTap = Gesture.Tap().numberOfTaps(1).maxDuration(220).onEnd(() => {
        'worklet';
        if (onSingleTap) runOnJS(onSingleTap)();
    });

    const taps = Gesture.Exclusive(doubleTap, singleTap);
    const composed = Platform.OS === 'web' ? taps : Gesture.Simultaneous(pinch, pan, taps);

    const animStyle = useAnimatedStyle(() => ({
        transform: [
            { scale: scale.value as number },
            { translateX: translateX.value as number },
            { translateY: translateY.value as number },
        ] as any,
    }));

    const imageFadeStyle = useAnimatedStyle(() => ({
        opacity: imageOpacity.value,
    }));

    return (
        <View style={styles.previewImageContainer}>
            <GestureDetector gesture={composed}>
                <Animated.View style={[styles.previewImageArea, { backgroundColor: CARD_BG }]}>
                    <Animated.View style={[{ flex: 1, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' }, animStyle]}>
                        {loading && (
                            <PreviewSkeleton />
                        )}
                        <Animated.View style={[{ width: '100%', height: '100%' }, imageFadeStyle]}>
                            {previewFailed ? (
                                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                                    <ImageIcon color="#F59E0B" size={48} style={{ marginBottom: 16 }} />
                                    <Text style={{ color: '#F59E0B', fontSize: 16 }}>Preview unavailable</Text>
                                </View>
                            ) : (
                                <Image
                                    source={imageSource}
                                    style={{ width: '100%', height: '100%' }}
                                    contentFit="contain"
                                    onLoad={() => {
                                        setLoading(false);
                                        imageOpacity.value = withTiming(1, { duration: 240 });
                                    }}
                                    onError={() => {
                                        if (!useFallback) {
                                            setUseFallback(true);
                                            setLoading(true);
                                            imageOpacity.value = 0;
                                            return;
                                        }
                                        setPreviewFailed(true);
                                        setLoading(false);
                                        imageOpacity.value = withTiming(1, { duration: 180 });
                                    }}
                                />
                            )}
                        </Animated.View>
                    </Animated.View>
                </Animated.View>
            </GestureDetector>
        </View>
    );
}

// --------------------------------------------------------------------------
// Main Screen
// --------------------------------------------------------------------------

export default function FilePreviewScreen({ route, navigation }: any) {
    const { theme, isDark } = useTheme();
    const { token: jwt } = useAuth();
    const { addDownload, tasks } = useDownload();
    const { showToast } = useToast();
    const insets = useSafeAreaInsets();

    // Data Maps
    const routeFiles = Array.isArray(route?.params?.files) ? route.params.files : [];
    const allFiles = routeFiles.filter((f: any) => f?.mime_type !== 'inode/directory');
    const fallbackFile = route?.params?.file ?? null;
    const initialIndex = Number.isInteger(route?.params?.initialIndex) ? route.params.initialIndex : 0;
    
    // Deep Linking support via standard hook
    const deepLinkedFileId = String(route?.params?.fileId || '').trim();
    const [deepLinkedFile, setDeepLinkedFile] = useState<any>(null);

    const previewData = useMemo(() => {
        if (allFiles.length > 0) return allFiles;
        if (fallbackFile) return [fallbackFile];
        if (deepLinkedFile) return [deepLinkedFile];
        return [];
    }, [allFiles, fallbackFile, deepLinkedFile]);

    useEffect(() => {
        if (!deepLinkedFileId || allFiles.length > 0 || fallbackFile) return;
        apiClient.get(`/files/${deepLinkedFileId}/details`)
            .then(res => setDeepLinkedFile(res.data?.file || res.data))
            .catch(() => showToast('Could not load shared file', 'error'));
    }, [allFiles.length, deepLinkedFileId, fallbackFile, showToast]);

    // Local State
    const [filesState, setFilesState] = useState<any[]>(previewData);
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const [isZoomed, setIsZoomed] = useState(false);
    const [uiVisible, setUiVisible] = useState(true);
    const [isDownloadSubmitting, setIsDownloadSubmitting] = useState(false);
    const [downloadTaskId, setDownloadTaskId] = useState<string | null>(null);

    const [isShareModalVisible, setShareModalVisible] = useState(false);

    const [isOptionsVisible, setOptionsVisible] = useState(false);

    const [isRenameModalVisible, setRenameModalVisible] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [isRenaming, setIsRenaming] = useState(false);

    const [isMoveModalVisible, setMoveModalVisible] = useState(false);
    const [allFolders, setAllFolders] = useState<any[]>([]);
    const [isMoving, setIsMoving] = useState(false);
    const mutationPendingRef = useRef<Set<string>>(new Set());

    const file = filesState[currentIndex] || null;

    // Slide animation
    const slideX = useSharedValue(0);

    useEffect(() => {
        setFilesState((prev) => {
            if (prev.length === previewData.length && prev.every((entry, index) => entry?.id === previewData[index]?.id)) {
                return prev;
            }
            return previewData;
        });
        if (previewData.length === 0) {
            setCurrentIndex((prev) => (prev === 0 ? prev : 0));
            return;
        }
        const safeIndex = Math.min(Math.max(initialIndex, 0), previewData.length - 1);
        setCurrentIndex((prev) => (prev === safeIndex ? prev : safeIndex));
    }, [previewData, initialIndex]);

    const handleNext = useCallback(() => {
        if (currentIndex >= filesState.length - 1) return;
        // Slide left animation
        slideX.value = 0;
        slideX.value = withTiming(-width, { duration: 200 }, () => {
            runOnJS(setCurrentIndex)(currentIndex + 1);
            slideX.value = width;
            slideX.value = withTiming(0, { duration: 200 });
        });
    }, [filesState.length, currentIndex, slideX]);

    const handlePrev = useCallback(() => {
        if (currentIndex <= 0) return;
        // Slide right animation
        slideX.value = 0;
        slideX.value = withTiming(width, { duration: 200 }, () => {
            runOnJS(setCurrentIndex)(currentIndex - 1);
            slideX.value = -width;
            slideX.value = withTiming(0, { duration: 200 });
        });
    }, [currentIndex, slideX]);

    const beginFileMutation = useCallback((fileId?: string | null) => {
        const id = String(fileId || '').trim();
        if (!id) return false;
        if (mutationPendingRef.current.has(id)) return false;
        mutationPendingRef.current.add(id);
        return true;
    }, []);

    const endFileMutation = useCallback((fileId?: string | null) => {
        const id = String(fileId || '').trim();
        if (!id) return;
        mutationPendingRef.current.delete(id);
    }, []);

    const swipePan = useMemo(() => Gesture.Pan()
        .enabled(!isZoomed && Platform.OS !== 'web')
        .activeOffsetX([-50, 50])
        .onEnd((e) => {
            'worklet';
            if (e.translationX < -80) {
                runOnJS(handleNext)();
            } else if (e.translationX > 80) {
                runOnJS(handlePrev)();
            }
        }), [isZoomed, handleNext, handlePrev]);

    useEffect(() => {
        if (!downloadTaskId) return;
        const task = tasks.find(t => t.id === downloadTaskId);
        if (!task) return;
        if (task.status === 'queued' || task.status === 'downloading') {
            setIsDownloadSubmitting(true);
            return;
        }
        if (task.status === 'completed') {
            showToast('Download completed');
        } else if (task.status === 'failed') {
            showToast(task.error || 'Download failed', 'error');
        } else if (task.status === 'cancelled') {
            showToast('Download cancelled', 'error');
        }
        setIsDownloadSubmitting(false);
        setDownloadTaskId(null);
    }, [downloadTaskId, tasks, showToast]);
    
    const uiOpacity = useSharedValue(1);
    const triggerHaptic = useCallback((ms: number = 8) => {
        if (Platform.OS === 'web') return;
        Vibration.vibrate(ms);
    }, []);
    const toggleUI = () => {
        setUiVisible(!uiVisible);
        uiOpacity.value = withTiming(uiVisible ? 0 : 1, { duration: 250 });
    };
    const uiAnimStyle = useAnimatedStyle(() => ({ opacity: uiOpacity.value }));
    const slideAnimStyle = useAnimatedStyle(() => ({
        transform: [{ translateX: slideX.value }],
    }));

    const updateCurrentFile = useCallback((updater: (f: any) => any) => {
        setFilesState(prev => {
            if (!prev[currentIndex]) return prev;
            const next = [...prev];
            next[currentIndex] = updater(next[currentIndex]);
            return next;
        });
    }, [currentIndex]);

    const handleDownload = useCallback(() => {
        if (!file?.id || !jwt) {
            showToast('Missing file or session', 'error');
            return;
        }
        try {
            const id = addDownload(file.id, sanitizeFileName(file.name || file.file_name || 'download', 'download'), jwt, file.mime_type);
            setDownloadTaskId(id);
            setIsDownloadSubmitting(true);
            showToast('Download queued');
        } catch {
            setIsDownloadSubmitting(false);
            showToast('Could not start download', 'error');
        }
    }, [file, jwt, addDownload, showToast]);

    const handleOpenShare = useCallback(() => {
        if (!file?.id) return;
        triggerHaptic();
        setOptionsVisible(false);
        setShareModalVisible(true);
    }, [file?.id, triggerHaptic]);

    const handleToggleStar = useCallback(async () => {
        if (!file?.id) return;
        if (!beginFileMutation(file.id)) {
            showToast('Action already in progress');
            return;
        }
        triggerHaptic();
        setOptionsVisible(false);
        try {
            const response = await apiClient.patch(`/files/${file.id}/star`);
            const nextStarState = Boolean(response?.data?.is_starred);
            updateCurrentFile((f) => ({ ...f, is_starred: nextStarState }));
            emitFileUpdated(file.id, { is_starred: nextStarState });
            showToast(nextStarState ? 'Added to favorites' : 'Removed from favorites');
            syncAfterFileMutation({ clearCache: true });
        } catch {
            showToast('Could not update favorite', 'error');
        } finally {
            endFileMutation(file.id);
        }
    }, [file?.id, beginFileMutation, endFileMutation, showToast, updateCurrentFile, triggerHaptic]);

    const openRenameModal = useCallback(() => {
        if (!file) return;
        triggerHaptic();
        setRenameValue(sanitizeFileName(file.name || file.file_name || '', 'file'));
        setOptionsVisible(false);
        setRenameModalVisible(true);
    }, [file, triggerHaptic]);

    const handleRename = useCallback(async () => {
        const trimmed = sanitizeFileName(renameValue, 'file');
        if (!file?.id || !trimmed || isRenaming) return;
        if (!beginFileMutation(file.id)) {
            showToast('Action already in progress');
            return;
        }
        setIsRenaming(true);
        try {
            await apiClient.patch(`/files/${file.id}`, { name: trimmed, file_name: trimmed });
            updateCurrentFile((f) => ({ ...f, name: trimmed, file_name: trimmed }));
            emitFileUpdated(file.id, { name: trimmed, file_name: trimmed });
            setRenameModalVisible(false);
            showToast('File renamed');
            syncAfterFileMutation();
        } catch {
            showToast('Rename failed', 'error');
        } finally {
            setIsRenaming(false);
            endFileMutation(file.id);
        }
    }, [file?.id, renameValue, isRenaming, beginFileMutation, endFileMutation, showToast, updateCurrentFile]);

    const handleDelete = useCallback(() => {
        if (!file?.id) return;
        setOptionsVisible(false);
        Alert.alert(
            'Move to Trash',
            `Move "${sanitizeDisplayName(file?.name || file?.file_name || 'this file', 'this file')}" to trash?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Move to Trash',
                    style: 'destructive',
                    onPress: async () => {
                        if (!beginFileMutation(file.id)) {
                            showToast('Action already in progress');
                            return;
                        }
                        try {
                            const indexToDelete = currentIndex;
                            await apiClient.patch(`/files/${file.id}/trash`);
                            setFilesState((prev) => {
                                const nextFiles = prev.filter((_, idx) => idx !== indexToDelete);
                                const nextIndex = Math.min(indexToDelete, Math.max(0, nextFiles.length - 1));
                                setCurrentIndex(nextIndex);
                                return nextFiles;
                            });
                            emitFileDeleted(file.id);
                            showToast('Moved to trash');
                            syncAfterFileMutation();
                        } catch {
                            showToast('Could not move to trash', 'error');
                        } finally {
                            endFileMutation(file.id);
                        }
                    },
                },
            ]
        );
    }, [file, currentIndex, beginFileMutation, endFileMutation, showToast]);

    const openMoveModal = useCallback(async () => {
        if (!file?.id) return;
        triggerHaptic();
        setOptionsVisible(false);
        try {
            const res = await apiClient.get('/files/folders');
            const folders = Array.isArray(res.data) ? res.data : (res.data?.folders || []);
            setAllFolders(folders);
            setMoveModalVisible(true);
        } catch {
            showToast('Could not load folders', 'error');
        }
    }, [file?.id, showToast, triggerHaptic]);

    const handleMove = useCallback(async (targetFolderId: string | null) => {
        if (!file?.id || isMoving) return;
        if (!beginFileMutation(file.id)) {
            showToast('Action already in progress');
            return;
        }
        setIsMoving(true);
        try {
            await apiClient.post('/files/bulk', { ids: [file.id], action: 'move', folder_id: targetFolderId });
            setMoveModalVisible(false);
            emitFileUpdated(file.id, { folder_id: targetFolderId });
            showToast('File moved successfully');
            syncAfterFileMutation();
        } catch {
            showToast('Could not move file', 'error');
        } finally {
            setIsMoving(false);
            endFileMutation(file.id);
        }
    }, [file?.id, isMoving, beginFileMutation, endFileMutation, showToast]);

    // Design System
    const BG_COLOR = theme.colors.background;
    const CARD_BG = theme.colors.card;
    const TEXT_MAIN = theme.colors.textHeading;
    const TEXT_SUB = theme.colors.textBody;
    const ACCENT = theme.colors.primary;
    const BORDER = theme.colors.border;
    const INPUT_BG = theme.colors.inputBg;
    const DANGER = theme.colors.danger;
    const SURFACE_MUTED = theme.colors.surfaceMuted;

    const renderFileItem = ({ item }: { item: any }) => {
        const mime = item?.mime_type || '';
        if (mime.startsWith('image/')) {
            return (
                <ImagePreviewItem 
                    item={item} jwt={jwt} 
                    isZoomed={isZoomed} 
                    onZoomChange={setIsZoomed} 
                    onSingleTap={toggleUI} 
                    CARD_BG={CARD_BG}
                />
            );
        }
        if (mime.startsWith('video/')) {
            return (
                <View style={styles.previewImageContainer}>
                    <View style={[styles.previewImageArea, { backgroundColor: '#000' }]}>
                        <VideoPlayer 
                            url={buildApiFileUrl(API_BASE, item.id, 'stream')}
                            token={jwt}
                            width={width}
                            fileId={item.id} 
                        />
                    </View>
                </View>
            );
        }
        if (mime === 'application/pdf' || item?.type === 'pdf') {
            const pdfUrl = buildApiFileUrl(API_BASE, item.id, 'download');
            return (
                <View style={styles.previewImageContainer}>
                    <View style={[styles.previewImageArea, { backgroundColor: CARD_BG }]}>
                        {Platform.OS === 'web' ? (
                            <iframe src={pdfUrl} style={{ width: '100%', height: '100%', border: 'none' }} />
                        ) : Platform.OS === 'android' ? (
                            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
                                <FileText color={TEXT_SUB} size={64} style={{ marginBottom: 16 }} />
                                <Text style={{ color: TEXT_MAIN, fontSize: 18, fontWeight: '600', marginBottom: 8 }}>PDF Document</Text>
                                <Text style={{ color: TEXT_SUB, fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
                                    Android does not support inline PDF preview securely. Please download or open it in a native viewer.
                                </Text>
                                <TouchableOpacity 
                                    style={{ backgroundColor: ACCENT, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12 }}
                                    onPress={handleDownload}
                                >
                                    <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Download to View</Text>
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <WebView source={{ uri: pdfUrl, headers: { Authorization: `Bearer ${jwt}` } }} style={{ flex: 1, backgroundColor: 'transparent' }} />
                        )}
                    </View>
                </View>
            );
        }
        // Fallback generic
        return (
            <View style={styles.previewImageContainer}>
                <View style={[styles.previewImageArea, { backgroundColor: CARD_BG, justifyContent: 'center', alignItems: 'center' }]}>
                    <FileText color={TEXT_SUB} size={64} style={{ marginBottom: 16 }} />
                    <Text style={{ color: TEXT_SUB, fontSize: 16 }}>Preview not available</Text>
                </View>
            </View>
        );
    };

    const formatBytes = (bytes: number) => {
        if (!bytes) return '0 B';
        const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + s[i];
    };

    const handleViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
        if (viewableItems.length > 0) setCurrentIndex(viewableItems[0].index || 0);
    }).current;

    useEffect(() => {
        if (filesState.length === 0) {
            navigation.goBack();
            return;
        }
        if (currentIndex > filesState.length - 1) {
            setCurrentIndex(filesState.length - 1);
        }
    }, [filesState.length, currentIndex, navigation]);

    const hasMultipleFiles = filesState.length > 1;

    return (
        <View style={[styles.container, { backgroundColor: BG_COLOR, paddingTop: insets.top }]}>
            
            {/* Header */}
            <Animated.View style={[styles.header, uiAnimStyle, { borderBottomColor: BORDER }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
                    <ArrowLeft color={TEXT_MAIN} size={22} />
                </TouchableOpacity>

                <View style={styles.headerCenter}>
                    <Text style={[styles.headerTitle, { color: TEXT_MAIN }]} numberOfLines={1}>
                        {sanitizeDisplayName(file?.name || file?.file_name || 'File Preview', 'File Preview')}
                    </Text>
                    {hasMultipleFiles && (
                        <Text style={[styles.headerSub, { color: TEXT_SUB }]}>
                            {currentIndex + 1} of {filesState.length}
                        </Text>
                    )}
                </View>

                <View style={styles.headerRight}>
                    <TouchableOpacity style={styles.iconBtn} onPress={handleToggleStar}>
                        <Star color={file?.is_starred ? '#F59E0B' : TEXT_MAIN} size={20} fill={file?.is_starred ? '#F59E0B' : 'transparent'} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.iconBtn} onPress={() => { triggerHaptic(); setOptionsVisible(true); }}>
                        <MoreHorizontal color={TEXT_MAIN} size={20} />
                    </TouchableOpacity>
                </View>
            </Animated.View>

            {/* Preview Area with slide animation */}
            <View style={styles.swiperArea}>
                {filesState.length > 0 && file ? (
                    <GestureDetector gesture={swipePan}>
                        <Animated.View style={[{ flex: 1 }, slideAnimStyle]} key={file.id}>
                            {renderFileItem({ item: file })}
                        </Animated.View>
                    </GestureDetector>
                ) : (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <ActivityIndicator size="large" color={ACCENT} />
                    </View>
                )}

                {/* Navigation arrows for multiple files */}
                {hasMultipleFiles && uiVisible && (
                    <>
                        {currentIndex > 0 && (
                            <TouchableOpacity 
                                style={[styles.navArrow, styles.navArrowLeft, { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)' }]} 
                                onPress={handlePrev}
                                activeOpacity={0.7}
                            >
                                <ChevronLeft color={TEXT_MAIN} size={20} />
                            </TouchableOpacity>
                        )}
                        {currentIndex < filesState.length - 1 && (
                            <TouchableOpacity 
                                style={[styles.navArrow, styles.navArrowRight, { backgroundColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.06)' }]} 
                                onPress={handleNext}
                                activeOpacity={0.7}
                            >
                                <ChevronRight color={TEXT_MAIN} size={20} />
                            </TouchableOpacity>
                        )}
                    </>
                )}
            </View>

            {/* Bottom Info + Actions — in flow, not absolute */}
            <Animated.View style={[styles.bottomContainer, uiAnimStyle, { backgroundColor: BG_COLOR, borderTopColor: BORDER }]}>
                
                {/* File info row */}
                <View style={styles.infoRow}>
                    <View style={styles.infoCol}>
                        <Text style={[styles.infoLabel, { color: TEXT_SUB }]}>Size</Text>
                        <Text style={[styles.infoValue, { color: TEXT_MAIN }]}>{formatBytes(file?.size ?? file?.file_size)}</Text>
                    </View>
                    <View style={styles.infoCol}>
                        <Text style={[styles.infoLabel, { color: TEXT_SUB }]}>Modified</Text>
                        <Text style={[styles.infoValue, { color: TEXT_MAIN }]}>
                            {file?.updated_at ? new Date(file.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown'}
                        </Text>
                    </View>
                    <View style={[styles.infoCol, { alignItems: 'flex-end' }]}>
                        <Text style={[styles.infoLabel, { color: TEXT_SUB }]}>Access</Text>
                        <Text style={[styles.infoValue, { color: TEXT_MAIN }]}>{file?.is_public ? 'Public' : 'Private'}</Text>
                    </View>
                </View>

                {/* Page indicator dots */}
                {hasMultipleFiles && (
                    <View style={styles.dotsRow}>
                        {filesState.map((_, idx) => (
                            <View 
                                key={idx} 
                                style={[
                                    styles.dot, 
                                    idx === currentIndex 
                                        ? { backgroundColor: ACCENT, width: 18 } 
                                        : { backgroundColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)' }
                                ]} 
                            />
                        ))}
                    </View>
                )}

                {/* Action Bar */}
                <View style={[styles.actionBar, { borderTopColor: BORDER }]}>
                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: SURFACE_MUTED }]} onPress={() => void openMoveModal()}>
                        <FolderInput color={TEXT_MAIN} size={20} />
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.primaryActionBtn, { backgroundColor: ACCENT }]} onPress={handleDownload} disabled={isDownloadSubmitting}>
                        {isDownloadSubmitting ? (
                            <ActivityIndicator color="#FFF" />
                        ) : (
                            <>
                                <Download color="#FFF" size={18} strokeWidth={2.5}/>
                                <Text style={styles.primaryActionText}>Download</Text>
                            </>
                        )}
                    </TouchableOpacity>

                    <TouchableOpacity style={[styles.actionBtn, { backgroundColor: SURFACE_MUTED }]} onPress={handleOpenShare}>
                        <Share2 color={TEXT_MAIN} size={20} />
                    </TouchableOpacity>
                </View>

            </Animated.View>

            <Modal visible={isOptionsVisible} transparent animationType="slide" onRequestClose={() => setOptionsVisible(false)}>
                <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={() => setOptionsVisible(false)}>
                    <TouchableOpacity activeOpacity={1} style={{ width: '100%' }}>
                        <Animated.View entering={FadeIn.duration(180)} style={[styles.sheetCard, { backgroundColor: CARD_BG, borderColor: BORDER }]}>
                            <View style={[styles.sheetHandle, { backgroundColor: BORDER }]} />
                        <Text style={[styles.sheetTitle, { color: TEXT_MAIN }]} numberOfLines={1}>
                            {sanitizeDisplayName(file?.name || file?.file_name || 'File Actions', 'File Actions')}
                        </Text>
                        <TouchableOpacity style={styles.optionRow} onPress={handleOpenShare}>
                            <Share2 color={ACCENT} size={20} />
                            <Text style={[styles.optionText, { color: TEXT_MAIN }]}>Share</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.optionRow} onPress={openRenameModal}>
                            <Pencil color={TEXT_MAIN} size={20} />
                            <Text style={[styles.optionText, { color: TEXT_MAIN }]}>Rename</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.optionRow} onPress={handleToggleStar}>
                            <Star color={file?.is_starred ? '#F59E0B' : TEXT_MAIN} size={20} fill={file?.is_starred ? '#F59E0B' : 'transparent'} />
                            <Text style={[styles.optionText, { color: TEXT_MAIN }]}>{file?.is_starred ? 'Unstar' : 'Star'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.optionRow} onPress={() => void openMoveModal()}>
                            <FolderInput color={TEXT_MAIN} size={20} />
                            <Text style={[styles.optionText, { color: TEXT_MAIN }]}>Move</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.optionRow} onPress={handleDelete}>
                            <Trash2 color={DANGER} size={20} />
                            <Text style={[styles.optionText, { color: DANGER, fontWeight: '700' }]}>Delete</Text>
                        </TouchableOpacity>
                    </Animated.View>
                    </TouchableOpacity>
                </TouchableOpacity>
            </Modal>

            <Modal visible={isRenameModalVisible} transparent animationType="fade" onRequestClose={() => setRenameModalVisible(false)}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.centeredModal}>
                    <TouchableOpacity activeOpacity={1} style={{ width: '100%', alignItems: 'center' }}>
                        <Animated.View entering={FadeIn.duration(150)} style={[styles.renameCard, { backgroundColor: CARD_BG, borderColor: BORDER }]}>
                            <Text style={[styles.renameTitle, { color: TEXT_MAIN }]}>Rename File</Text>
                        <TextInput
                            style={[styles.renameInput, { borderColor: BORDER, color: TEXT_MAIN, backgroundColor: INPUT_BG }]}
                            value={renameValue}
                            onChangeText={setRenameValue}
                            autoFocus
                            placeholder="Enter new name"
                            placeholderTextColor={TEXT_SUB}
                            onSubmitEditing={handleRename}
                        />
                        <View style={styles.renameActions}>
                            <TouchableOpacity style={[styles.renameBtn, { backgroundColor: INPUT_BG }]} onPress={() => setRenameModalVisible(false)}>
                                <Text style={[styles.renameBtnText, { color: TEXT_MAIN }]}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.renameBtn, { backgroundColor: ACCENT }]} onPress={handleRename} disabled={isRenaming || !sanitizeFileName(renameValue, '').trim()}>
                                {isRenaming ? <ActivityIndicator color="#FFF" /> : <Text style={[styles.renameBtnText, { color: '#FFF' }]}>Rename</Text>}
                            </TouchableOpacity>
                        </View>
                    </Animated.View>
                    </TouchableOpacity>
                </KeyboardAvoidingView>
            </Modal>

            <Modal visible={isMoveModalVisible} transparent animationType="slide" onRequestClose={() => setMoveModalVisible(false)}>
                <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={() => setMoveModalVisible(false)}>
                    <TouchableOpacity activeOpacity={1} style={{ width: '100%' }}>
                        <Animated.View entering={FadeIn.duration(180)} style={[styles.sheetCard, { backgroundColor: CARD_BG, borderColor: BORDER }]}>
                            <View style={[styles.sheetHandle, { backgroundColor: BORDER }]} />
                        <Text style={[styles.sheetTitle, { color: TEXT_MAIN }]}>Move File To</Text>
                        <Text style={[styles.sheetSub, { color: TEXT_SUB }]}>Select destination folder.</Text>

                        <TouchableOpacity style={styles.optionRow} onPress={() => void handleMove(null)} disabled={isMoving}>
                            <FolderInput color={ACCENT} size={20} />
                            <Text style={[styles.optionText, { color: TEXT_MAIN }]}>Home (Root)</Text>
                        </TouchableOpacity>
                        {allFolders.filter((f) => String(f.id) !== String(file?.folder_id || '')).map((f) => (
                            <TouchableOpacity key={String(f.id)} style={styles.optionRow} onPress={() => void handleMove(String(f.id))} disabled={isMoving}>
                                <FolderInput color={TEXT_MAIN} size={20} />
                                <Text style={[styles.optionText, { color: TEXT_MAIN }]} numberOfLines={1}>{f.name}</Text>
                            </TouchableOpacity>
                        ))}
                        {isMoving && <ActivityIndicator style={{ marginTop: 8 }} color={ACCENT} />}
                    </Animated.View>
                    </TouchableOpacity>
                </TouchableOpacity>
            </Modal>

            <ShareFolderModal
                visible={isShareModalVisible}
                onClose={() => setShareModalVisible(false)}
                targetItem={file}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },

    /* Header */
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        height: 56, paddingHorizontal: 12,
        borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 10,
    },
    headerBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    iconBtn: { padding: 8 },

    headerCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
    headerTitle: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
    headerSub: { fontSize: 11, fontWeight: '500', marginTop: 1 },

    /* Preview Area */
    swiperArea: { flex: 1, justifyContent: 'center', position: 'relative' },
    previewImageContainer: {
        flex: 1,
        justifyContent: 'center', alignItems: 'center',
    },
    previewImageArea: {
        width: '100%', height: '100%',
        overflow: 'hidden',
    },

    /* Navigation Arrows */
    navArrow: {
        position: 'absolute',
        top: '50%',
        marginTop: -18,
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    navArrowLeft: { left: 8 },
    navArrowRight: { right: 8 },

    /* Bottom Info & Actions — in flow, not absolute */
    bottomContainer: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    },
    
    // Info Row
    infoRow: {
        flexDirection: 'row', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 10,
    },
    infoCol: { flex: 1 },
    infoLabel: { fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
    infoValue: { fontSize: 13, fontWeight: '500' },

    // Page dots
    dotsRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 5,
        paddingBottom: 8,
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },

    // Action Bar
    actionBar: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 16, paddingTop: 10,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    actionBtn: {
        width: 46, height: 46, borderRadius: 23,
        justifyContent: 'center', alignItems: 'center',
    },
    primaryActionBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        height: 48, borderRadius: 24, flex: 1, marginHorizontal: 12,
        shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 4,
    },
    primaryActionText: { color: '#FFF', fontSize: 15, fontWeight: '600', marginLeft: 8 },

    // Shared sheets
    sheetOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
        backgroundColor: 'rgba(0,0,0,0.35)',
    },
    sheetCard: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        borderWidth: 1,
        borderBottomWidth: 0,
        paddingHorizontal: 20,
        paddingTop: 12,
        paddingBottom: Platform.OS === 'ios' ? 34 : 20,
        gap: 10,
    },
    sheetHandle: {
        width: 40,
        height: 4,
        borderRadius: 4,
        alignSelf: 'center',
        marginBottom: 4,
    },
    sheetTitle: {
        fontSize: 18,
        fontWeight: '700',
    },
    sheetSub: {
        fontSize: 13,
        fontWeight: '500',
        marginBottom: 2,
    },
    linkBox: {
        borderWidth: 1,
        borderRadius: 12,
        minHeight: 48,
        paddingHorizontal: 12,
        justifyContent: 'center',
    },
    linkLoadingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    linkText: {
        fontSize: 13,
        fontWeight: '500',
    },
    sheetActionRow: {
        flexDirection: 'row',
        gap: 10,
        marginTop: 2,
    },
    sheetActionBtn: {
        flex: 1,
        minHeight: 44,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'row',
        gap: 6,
    },
    sheetActionText: {
        fontSize: 14,
        fontWeight: '600',
    },

    // Options + move
    optionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        borderRadius: 12,
    },
    optionText: {
        flex: 1,
        fontSize: 15,
        fontWeight: '500',
    },

    // Rename modal
    centeredModal: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
        backgroundColor: 'rgba(0,0,0,0.35)',
    },
    renameCard: {
        width: '100%',
        borderRadius: 16,
        borderWidth: 1,
        padding: 16,
    },
    renameTitle: {
        fontSize: 18,
        fontWeight: '700',
        marginBottom: 12,
    },
    renameInput: {
        height: 48,
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 12,
        fontSize: 15,
        marginBottom: 14,
    },
    renameActions: {
        flexDirection: 'row',
        gap: 10,
    },
    renameBtn: {
        flex: 1,
        minHeight: 44,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    renameBtnText: {
        fontSize: 15,
        fontWeight: '600',
    },
});
