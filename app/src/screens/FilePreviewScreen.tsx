import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator,
    Dimensions, Platform, FlatList, ViewToken, Modal, TextInput,
    Alert, Share, KeyboardAvoidingView, Vibration
} from 'react-native';
import {
    ArrowLeft, Download, Star, Share2, MoreHorizontal,
    FolderInput, Trash2, Pencil,
    FileText, X, Copy
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { Image } from '../components/AppImage';
import VideoPlayer from '../components/VideoPlayer';
import PreviewSkeleton from '../components/PreviewSkeleton';
import { WebView } from 'react-native-webview';

import apiClient, { API_BASE } from '../services/apiClient';
import { useToast } from '../context/ToastContext';
import { useDownload } from '../context/DownloadContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { normalizeExternalShareUrl } from '../utils/shareUrls';
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
    const { isDark } = useTheme();
    const [loading, setLoading] = useState(true);
    const [useFallback, setUseFallback] = useState(false);
    
    // File URLs
    const thumbUrl = buildApiFileUrl(API_BASE, item.id, 'thumbnail');
    const downloadUrl = buildApiFileUrl(API_BASE, item.id, 'download');
    const headers = { Authorization: `Bearer ${jwt}` };
    const src = useFallback ? downloadUrl : thumbUrl;

    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const savedTransX = useSharedValue(0);
    const savedTransY = useSharedValue(0);
    const imageOpacity = useSharedValue(0);

    useEffect(() => {
        setLoading(true); setUseFallback(false);
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
        .activeOffsetX([-20, 20])
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
        <View style={styles.previewCardContainer}>
            <GestureDetector gesture={composed}>
                <Animated.View style={[styles.previewCard, { backgroundColor: CARD_BG }]}>
                    <Animated.View style={[{ flex: 1, overflow: 'hidden', borderRadius: 16, justifyContent: 'center', alignItems: 'center' }, animStyle]}>
                        {loading && (
                            <PreviewSkeleton />
                        )}
                        <Animated.View style={[{ width: '100%', height: '100%' }, imageFadeStyle]}>
                            <Image
                                source={{ uri: src, headers }}
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
                                    } else {
                                        setLoading(false);
                                        imageOpacity.value = withTiming(1, { duration: 180 });
                                    }
                                }}
                            />
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
    const { isDark } = useTheme();
    const { token: jwt } = useAuth();
    const { addDownload, tasks } = useDownload();
    const { showToast } = useToast();

    // Data Maps
    const routeFiles = Array.isArray(route?.params?.files) ? route.params.files : [];
    const allFiles = routeFiles.filter((f: any) => f?.mime_type !== 'inode/directory');
    const fallbackFile = route?.params?.file ?? null;
    const initialIndex = Number.isInteger(route?.params?.initialIndex) ? route.params.initialIndex : 0;
    
    // Deep Linking support via standard hook
    const deepLinkedFileId = String(route?.params?.fileId || '').trim();
    const [deepLinkedFile, setDeepLinkedFile] = useState<any>(null);

    const previewData = allFiles.length > 0 ? allFiles : (fallbackFile ? [fallbackFile] : (deepLinkedFile ? [deepLinkedFile] : []));
    const listRef = useRef<FlatList<any>>(null);

    useEffect(() => {
        if (!deepLinkedFileId || allFiles.length > 0 || fallbackFile) return;
        apiClient.get(`/files/${deepLinkedFileId}`)
            .then(res => setDeepLinkedFile(res.data))
            .catch(() => showToast('Could not load shared file', 'error'));
    }, [deepLinkedFileId]);

    // Local State
    const [filesState, setFilesState] = useState<any[]>(previewData);
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const [isZoomed, setIsZoomed] = useState(false);
    const [uiVisible, setUiVisible] = useState(true);
    const [isDownloadSubmitting, setIsDownloadSubmitting] = useState(false);
    const [downloadTaskId, setDownloadTaskId] = useState<string | null>(null);

    const [isShareModalVisible, setShareModalVisible] = useState(false);
    const [isGeneratingShare, setGeneratingShare] = useState(false);
    const [shareLink, setShareLink] = useState('');

    const [isOptionsVisible, setOptionsVisible] = useState(false);

    const [isRenameModalVisible, setRenameModalVisible] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [isRenaming, setIsRenaming] = useState(false);

    const [isMoveModalVisible, setMoveModalVisible] = useState(false);
    const [allFolders, setAllFolders] = useState<any[]>([]);
    const [isMoving, setIsMoving] = useState(false);

    const file = filesState[currentIndex] || null;

    useEffect(() => {
        setFilesState(previewData);
        if (previewData.length === 0) {
            setCurrentIndex(0);
            return;
        }
        const safeIndex = Math.min(Math.max(initialIndex, 0), previewData.length - 1);
        setCurrentIndex(safeIndex);
        requestAnimationFrame(() => {
            listRef.current?.scrollToIndex({ index: safeIndex, animated: false });
        });
    }, [previewData, initialIndex]);

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

    const generateShareLink = useCallback(async () => {
        if (!file?.id) return;
        setGeneratingShare(true);
        setShareLink('');
        try {
            const res = await apiClient.post('/api/v2/shares', {
                resource_type: 'file',
                root_file_id: file.id,
                expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
            });
            const link = normalizeExternalShareUrl(String(res.data?.share_url || res.data?.shareUrl || ''));
            if (!link) {
                showToast('Share link not returned', 'error');
                return;
            }
            setShareLink(link);
            showToast('Link generated');
        } catch {
            showToast('Share failed', 'error');
        } finally {
            setGeneratingShare(false);
        }
    }, [file?.id, showToast]);

    const handleOpenShare = useCallback(() => {
        if (!file?.id) return;
        triggerHaptic();
        setOptionsVisible(false);
        setShareModalVisible(true);
        void generateShareLink();
    }, [file?.id, generateShareLink, triggerHaptic]);

    const handleCopyShareLink = useCallback(async () => {
        if (!shareLink) return;
        await Clipboard.setStringAsync(shareLink);
        showToast('Link copied');
    }, [shareLink, showToast]);

    const handleNativeShareLink = useCallback(async () => {
        if (!shareLink) return;
        try {
            await Share.share({ message: shareLink, url: shareLink });
        } catch {
            showToast('System share unavailable', 'error');
        }
    }, [shareLink, showToast]);

    const handleToggleStar = useCallback(async () => {
        if (!file?.id) return;
        triggerHaptic();
        setOptionsVisible(false);
        try {
            await apiClient.patch(`/files/${file.id}/star`);
            updateCurrentFile((f) => ({ ...f, is_starred: !f?.is_starred }));
            emitFileUpdated(file.id, { is_starred: !file.is_starred });
            showToast(file?.is_starred ? 'Removed from favorites' : 'Added to favorites');
            syncAfterFileMutation({ clearCache: true });
        } catch {
            showToast('Could not update favorite', 'error');
        }
    }, [file?.id, file?.is_starred, showToast, updateCurrentFile, triggerHaptic]);

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
        }
    }, [file?.id, renameValue, isRenaming, showToast, updateCurrentFile]);

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
                        try {
                            await apiClient.patch(`/files/${file.id}/trash`);
                            setFilesState(prev => prev.filter((f, idx) => idx !== currentIndex));
                            emitFileDeleted(file.id);
                            showToast('Moved to trash');
                            syncAfterFileMutation();
                        } catch {
                            showToast('Could not move to trash', 'error');
                        }
                    },
                },
            ]
        );
    }, [file, currentIndex, showToast]);

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
        }
    }, [file?.id, isMoving, showToast]);

    // Design System
    const BG_COLOR = isDark ? '#050505' : '#FFFFFF';
    const CARD_BG = isDark ? '#141414' : '#F5F7FB';
    const TEXT_MAIN = isDark ? '#FFFFFF' : '#111827';
    const TEXT_SUB = isDark ? '#A0A0A0' : '#6B7280';
    const ACCENT = '#3B82F6'; // Axya Blue (can adapt to primary accent)
    const BORDER = isDark ? '#222222' : '#EBEEF2';

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
                <View style={styles.previewCardContainer}>
                    <View style={[styles.previewCard, { backgroundColor: CARD_BG }]}>
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
        if (mime === 'application/pdf') {
            const pdfUrl = buildApiFileUrl(API_BASE, item.id, 'download');
            return (
                <View style={styles.previewCardContainer}>
                    <View style={[styles.previewCard, { backgroundColor: CARD_BG }]}>
                        {Platform.OS === 'web' ? (
                            <iframe src={pdfUrl} style={{ width: '100%', height: '100%', border: 'none', borderRadius: 16 }} />
                        ) : (
                            <WebView source={{ uri: pdfUrl }} style={{ flex: 1, backgroundColor: 'transparent' }} />
                        )}
                    </View>
                </View>
            );
        }
        // Fallback generic
        return (
            <View style={styles.previewCardContainer}>
                <View style={[styles.previewCard, { backgroundColor: CARD_BG, justifyContent: 'center', alignItems: 'center' }]}>
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
            requestAnimationFrame(() => {
                listRef.current?.scrollToIndex({ index: filesState.length - 1, animated: true });
            });
        }
    }, [filesState.length, currentIndex, navigation]);
    
    const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: BG_COLOR }]}>
            
            {/* Header */}
            <Animated.View style={[styles.header, uiAnimStyle, { borderBottomColor: BORDER }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn}>
                    <ArrowLeft color={TEXT_MAIN} size={22} />
                </TouchableOpacity>

                <View style={styles.headerCenter}>
                    <Text style={[styles.headerTitle, { color: TEXT_MAIN }]} numberOfLines={1}>
                        {sanitizeDisplayName(file?.name || file?.file_name || 'File Preview', 'File Preview')}
                    </Text>
                    <Text style={[styles.headerSub, { color: TEXT_SUB }]}>
                        {file?.mime_type 
                            ? file?.mime_type.split('/')[1]?.toUpperCase() || 'FILE' 
                            : 'FILE'} 
                        {filesState.length > 0 ? ` • ${currentIndex + 1}/${filesState.length}` : ''}
                    </Text>
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

            {/* Swiper */}
            <View style={styles.swiperArea}>
                {filesState.length > 0 ? (
                    <FlatList
                        ref={listRef}
                        data={filesState}
                        keyExtractor={(item, idx) => `${item?.id || idx}`}
                        initialScrollIndex={Math.min(Math.max(initialIndex, 0), Math.max(filesState.length - 1, 0))}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        scrollEnabled={Platform.OS === 'web' ? true : !isZoomed}
                        bounces={false}
                        overScrollMode="never"
                        onViewableItemsChanged={handleViewableItemsChanged}
                        viewabilityConfig={viewabilityConfig}
                        renderItem={renderFileItem}
                        onScrollToIndexFailed={(info) => {
                            setTimeout(() => {
                                listRef.current?.scrollToIndex({ index: info.index, animated: false });
                            }, 120);
                        }}
                        getItemLayout={(data, index) => ({ length: width, offset: width * index, index })}
                        contentContainerStyle={{ flexGrow: 1 }}
                    />
                ) : (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <ActivityIndicator size="large" color="#3B82F6" />
                    </View>
                )}
            </View>

            {/* Info Row + Actions Overlay */}
            <Animated.View style={[styles.bottomContainer, uiAnimStyle]}>
                
                {/* 3-Column Info (Size | Date | Type) */}
                <View style={styles.infoRow}>
                    <View style={styles.infoCol}>
                        <Text style={[styles.infoLabel, { color: TEXT_SUB }]}>Size</Text>
                        <Text style={[styles.infoValue, { color: TEXT_MAIN }]}>{formatBytes(file?.size)}</Text>
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

                {/* Primary Sticky Action Bar */}
                <View style={[styles.actionBar, { borderTopColor: BORDER }]}>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => void openMoveModal()}>
                        <FolderInput color={TEXT_MAIN} size={22} />
                    </TouchableOpacity>

                    {/* BIG Primary Action */}
                    <TouchableOpacity style={[styles.primaryActionBtn, { backgroundColor: ACCENT }]} onPress={handleDownload} disabled={isDownloadSubmitting}>
                        {isDownloadSubmitting ? (
                            <ActivityIndicator color="#FFF" />
                        ) : (
                            <>
                                <Download color="#FFF" size={20} strokeWidth={2.5}/>
                                <Text style={styles.primaryActionText}>Download</Text>
                            </>
                        )}
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.actionBtn} onPress={handleOpenShare}>
                        <Share2 color={TEXT_MAIN} size={22} />
                    </TouchableOpacity>
                </View>

            </Animated.View>

            <Modal visible={isShareModalVisible} transparent animationType="slide" onRequestClose={() => setShareModalVisible(false)}>
                <TouchableOpacity
                    style={styles.sheetOverlay}
                    activeOpacity={1}
                    onPress={() => setShareModalVisible(false)}
                >
                    <Animated.View entering={FadeIn.duration(180)} style={[styles.sheetCard, { backgroundColor: CARD_BG, borderColor: BORDER }]}>
                        <View style={[styles.sheetHandle, { backgroundColor: BORDER }]} />
                        <Text style={[styles.sheetTitle, { color: TEXT_MAIN }]}>Share File</Text>
                        <Text style={[styles.sheetSub, { color: TEXT_SUB }]}>Generate and copy a public share link.</Text>

                        <View style={[styles.linkBox, { borderColor: BORDER, backgroundColor: isDark ? '#0B1220' : '#FFFFFF' }]}>
                            {isGeneratingShare ? (
                                <View style={styles.linkLoadingRow}>
                                    <ActivityIndicator color={ACCENT} />
                                    <Text style={[styles.linkText, { color: TEXT_SUB }]}>Generating link...</Text>
                                </View>
                            ) : (
                                <Text style={[styles.linkText, { color: shareLink ? TEXT_MAIN : TEXT_SUB }]} numberOfLines={1}>
                                    {shareLink || 'No link yet'}
                                </Text>
                            )}
                        </View>

                        <View style={styles.sheetActionRow}>
                            <TouchableOpacity
                                style={[styles.sheetActionBtn, { backgroundColor: isDark ? '#1E293B' : '#E5E7EB' }]}
                                onPress={() => { triggerHaptic(); void generateShareLink(); }}
                                disabled={isGeneratingShare}
                            >
                                <Text style={[styles.sheetActionText, { color: TEXT_MAIN }]}>Regenerate</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.sheetActionBtn, { backgroundColor: isDark ? '#1E293B' : '#E5E7EB' }]}
                                onPress={() => { triggerHaptic(); void handleCopyShareLink(); }}
                                disabled={!shareLink}
                            >
                                <Copy color={TEXT_MAIN} size={16} />
                                <Text style={[styles.sheetActionText, { color: TEXT_MAIN }]}>Copy</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.sheetActionBtn, { backgroundColor: ACCENT }]}
                                onPress={() => { triggerHaptic(); void handleNativeShareLink(); }}
                                disabled={!shareLink}
                            >
                                <Share2 color="#FFFFFF" size={16} />
                                <Text style={[styles.sheetActionText, { color: '#FFFFFF' }]}>Share</Text>
                            </TouchableOpacity>
                        </View>
                    </Animated.View>
                </TouchableOpacity>
            </Modal>

            <Modal visible={isOptionsVisible} transparent animationType="slide" onRequestClose={() => setOptionsVisible(false)}>
                <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={() => setOptionsVisible(false)}>
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
                            <Trash2 color="#EF4444" size={20} />
                            <Text style={[styles.optionText, { color: '#EF4444', fontWeight: '700' }]}>Delete</Text>
                        </TouchableOpacity>
                    </Animated.View>
                </TouchableOpacity>
            </Modal>

            <Modal visible={isRenameModalVisible} transparent animationType="fade" onRequestClose={() => setRenameModalVisible(false)}>
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.centeredModal}>
                    <Animated.View entering={FadeIn.duration(150)} style={[styles.renameCard, { backgroundColor: CARD_BG, borderColor: BORDER }]}>
                        <Text style={[styles.renameTitle, { color: TEXT_MAIN }]}>Rename File</Text>
                        <TextInput
                            style={[styles.renameInput, { borderColor: BORDER, color: TEXT_MAIN, backgroundColor: isDark ? '#0B1220' : '#FFFFFF' }]}
                            value={renameValue}
                            onChangeText={setRenameValue}
                            autoFocus
                            placeholder="Enter new name"
                            placeholderTextColor={TEXT_SUB}
                            onSubmitEditing={handleRename}
                        />
                        <View style={styles.renameActions}>
                            <TouchableOpacity style={[styles.renameBtn, { backgroundColor: isDark ? '#1E293B' : '#E5E7EB' }]} onPress={() => setRenameModalVisible(false)}>
                                <Text style={[styles.renameBtnText, { color: TEXT_MAIN }]}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.renameBtn, { backgroundColor: ACCENT }]} onPress={handleRename} disabled={isRenaming || !sanitizeFileName(renameValue, '').trim()}>
                                {isRenaming ? <ActivityIndicator color="#FFF" /> : <Text style={[styles.renameBtnText, { color: '#FFF' }]}>Rename</Text>}
                            </TouchableOpacity>
                        </View>
                    </Animated.View>
                </KeyboardAvoidingView>
            </Modal>

            <Modal visible={isMoveModalVisible} transparent animationType="slide" onRequestClose={() => setMoveModalVisible(false)}>
                <TouchableOpacity style={styles.sheetOverlay} activeOpacity={1} onPress={() => setMoveModalVisible(false)}>
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
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },

    /* Header */
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        height: 60, paddingHorizontal: 16,
        borderBottomWidth: 1, zIndex: 10,
    },
    headerBtn: { width: 40, height: 40, justifyContent: 'center' },
    headerRight: { flexDirection: 'row', alignItems: 'center', width: 80, justifyContent: 'flex-end', gap: 8 },
    iconBtn: { padding: 8 },

    headerCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 12 },
    headerTitle: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
    headerSub: { fontSize: 12, fontWeight: '500', marginTop: 2, textTransform: 'uppercase' },

    /* Preview Area */
    swiperArea: { flex: 1, justifyContent: 'center' },
    previewCardContainer: {
        width: width,
        height: height - 120, // Explicit height to prevent collapse in FlatList
        justifyContent: 'center', alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 12,
    },
    previewCard: {
        width: '100%', height: '100%',
        borderRadius: 16,
        overflow: 'hidden',
        // subtle shadow
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
    },

    /* Bottom Info & Actions */
    bottomContainer: {
        position: 'absolute', bottom: 0, width: '100%',
        zIndex: 10, paddingBottom: Platform.OS === 'ios' ? 24 : 16, // Safe area padding
        backgroundColor: 'rgba(255, 255, 255, 0.01)', // To ensure clicks pass through if needed, UI handles the stack
    },
    
    // Info Row
    infoRow: {
        flexDirection: 'row', justifyContent: 'space-between',
        paddingHorizontal: 24, marginBottom: 20,
    },
    infoCol: { flex: 1 },
    infoLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
    infoValue: { fontSize: 14, fontWeight: '500' },

    // Action Bar
    actionBar: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingTop: 16,
        borderTopWidth: 1,
    },
    actionBtn: {
        width: 50, height: 50, borderRadius: 25,
        justifyContent: 'center', alignItems: 'center',
        backgroundColor: 'rgba(100,100,100,0.05)'
    },
    primaryActionBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        height: 52, borderRadius: 26, flex: 1, marginHorizontal: 16,
        shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10, elevation: 4,
    },
    primaryActionText: { color: '#FFF', fontSize: 16, fontWeight: '600', marginLeft: 8 },

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
