import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator,
    Alert, Dimensions, Platform, Modal, KeyboardAvoidingView, ScrollView, TextInput,
    FlatList,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { ArrowLeft, Download, Trash2, FileText, FolderInput, Star, Link, CheckCircle, X } from 'lucide-react-native';

import { Image } from 'expo-image';
import VideoPlayer from '../components/VideoPlayer';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient, { API_BASE } from '../services/apiClient';
import { useToast } from '../context/ToastContext';
import { useDownload } from '../context/DownloadContext';
import { theme } from '../ui/theme';

// react-native-reanimated v3/v4 — import as `Animated` (standard naming)
import Animated2, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    runOnJS,
} from 'react-native-reanimated';

// react-native-gesture-handler v2
// GestureHandlerRootView is now in App.tsx — do NOT import here
import { GestureDetector, Gesture } from 'react-native-gesture-handler';

const { width, height } = Dimensions.get('window');

// ─────────────────────────────────────────────────────────────
// Module-level constants (safe to capture inside worklets)
// ─────────────────────────────────────────────────────────────
const MIN_SCALE = 1;
const MAX_SCALE = 5;
const IMG_H = height * 0.65;   // module-level — worklets can safely reference this
const SPRING_CFG = { damping: 20, stiffness: 200 };

// ─────────────────────────────────────────────────────────────
// ImagePreviewItem — pinch-zoom, pan, double-tap reset
// GestureHandlerRootView is at App.tsx root, not needed here.
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// ImagePreviewItem — pinch-zoom, pan, double-tap reset
// GestureHandlerRootView is at App.tsx root, not needed here.
// ─────────────────────────────────────────────────────────────
function ImagePreviewItem({
    item,
    jwt,
    isZoomed,
    onZoomChange,
}: { item: any; jwt: string; isZoomed: boolean; onZoomChange?: (zoomed: boolean) => void }) {
    const [loading, setLoading] = useState(true);
    const [useFallback, setUseFallback] = useState(false);
    const [errored, setErrored] = useState(false);

    const thumbUrl = `${API_BASE}/files/${item.id}/thumbnail`;
    const downloadUrl = `${API_BASE}/files/${item.id}/download`;
    const headers = { Authorization: `Bearer ${jwt}` };
    const src = useFallback ? downloadUrl : thumbUrl;

    // ── Gesture shared values ────────────────────────────────────────
    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const savedTransX = useSharedValue(0);
    const savedTransY = useSharedValue(0);

    // ── Pinch ────────────────────────────────────────────────────────
    const pinch = Gesture.Pinch()
        .onUpdate(e => {
            'worklet';
            scale.value = Math.max(MIN_SCALE, Math.min(MAX_SCALE, savedScale.value * e.scale));
        })
        .onEnd(() => {
            'worklet';
            if (scale.value < 1.05) {
                scale.value = withSpring(1, SPRING_CFG);
                translateX.value = withSpring(0, SPRING_CFG);
                translateY.value = withSpring(0, SPRING_CFG);
                savedScale.value = 1;
                savedTransX.value = 0;
                savedTransY.value = 0;
            } else {
                savedScale.value = scale.value;
                // clamp inline — module-level IMG_H is safe here
                const maxX = (width * (scale.value - 1)) / 2;
                const maxY = (IMG_H * (scale.value - 1)) / 2;
                const cx = Math.max(-maxX, Math.min(maxX, translateX.value));
                const cy = Math.max(-maxY, Math.min(maxY, translateY.value));
                translateX.value = cx;
                translateY.value = cy;
                savedTransX.value = cx;
                savedTransY.value = cy;
            }
            // Notify parent when zoom state changes (must use runOnJS from worklet)
            if (onZoomChange) {
                runOnJS(onZoomChange)(scale.value > 1.05);
            }
        });

    // ── Pan (completely disabled at 1× — lets FlatList handle swipe freely) ──
    // Using .enabled(isZoomed) prevents the Pan recognizer from even competing
    // with FlatList's scroll gesture. activeOffsetX/Y set a high distance
    // threshold so even if enabled, it doesn't fire on casual swipes.
    const pan = Gesture.Pan()
        .enabled(isZoomed)                // ← completely off at 1×, no gesture conflict
        .averageTouches(true)
        .activeOffsetX([-20, 20])         // must move 20px before activating
        .activeOffsetY([-10, 10])
        .onUpdate(e => {
            'worklet';
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

    // ── Double-tap to reset ──────────────────────────────────────────
    const doubleTap = Gesture.Tap()
        .numberOfTaps(2)
        .maxDelay(250)               // maxDelay not maxDuration (RNGH v2 API)
        .onEnd(() => {
            'worklet';
            scale.value = withSpring(1, SPRING_CFG);
            translateX.value = withSpring(0, SPRING_CFG);
            translateY.value = withSpring(0, SPRING_CFG);
            savedScale.value = 1;
            savedTransX.value = 0;
            savedTransY.value = 0;
        });

    // Pinch + pan run simultaneously; double-tap is parallel
    const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

    const animStyle = useAnimatedStyle(() => ({
        transform: [
            { scale: scale.value as number },
            { translateX: translateX.value as number },
            { translateY: translateY.value as number },
        ] as any,   // Reanimated v4 strict transform types — `as any` is safe here
    }));

    return (
        <View style={{ width, flex: 1, backgroundColor: '#0a0a0f' }}>
            {/* Loading spinner */}
            {loading && (
                <View style={StyleSheet.absoluteFillObject as any}>
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <ActivityIndicator size="large" color={theme.colors.primary} />
                        <Text style={{ color: 'rgba(255,255,255,0.6)', marginTop: 14, fontSize: 13, fontWeight: '500' }}>
                            {useFallback ? 'Loading image...' : 'Loading preview...'}
                        </Text>
                    </View>
                </View>
            )}

            {errored ? (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
                    <FileText color="rgba(255,255,255,0.3)" size={72} strokeWidth={1} />
                    <Text style={{ color: 'rgba(255,255,255,0.5)', marginTop: 16, fontSize: 14 }}>
                        Could not load image
                    </Text>
                </View>
            ) : (
                <GestureDetector gesture={composed}>
                    <Animated2.View
                        style={[{ width, height: IMG_H, justifyContent: 'center', alignItems: 'center' }, animStyle]}
                    >
                        <Image
                            source={{ uri: src, headers }}
                            style={{ width, height: IMG_H }}
                            contentFit="contain"
                            transition={300}
                            cachePolicy="disk"
                            onLoad={() => setLoading(false)}
                            onError={() => {
                                if (!useFallback) {
                                    setUseFallback(true);
                                    setLoading(true);
                                } else {
                                    setLoading(false);
                                    setErrored(true);
                                }
                            }}
                        />
                    </Animated2.View>
                </GestureDetector>
            )}
        </View>
    );
}

// ─────────────────────────────────────────────────────────────
// PdfOpenButton — downloads PDF to cache, opens with system app
// Works in Expo Go (no native modules needed)
// ─────────────────────────────────────────────────────────────
function PdfOpenButton({ url, jwt, fileName }: { url: string; jwt: string; fileName: string }) {
    const [downloading, setDownloading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const openPdfExternally = async () => {
        setDownloading(true);
        setError(null);
        try {
            // Sanitize filename for filesystem
            const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
            const localUri = `${Paths.cache.uri}${safeName}`;

            // Download PDF with auth header using legacy API (proven pattern in this project)
            const downloadResult = await LegacyFileSystem.downloadAsync(url, localUri, {
                headers: { Authorization: `Bearer ${jwt}` },
            });

            if (downloadResult.status !== 200) {
                throw new Error(`Download failed with status ${downloadResult.status}`);
            }

            if (Platform.OS === 'android') {
                // Convert file:// URI to content:// URI for Android intent
                const contentUri = await LegacyFileSystem.getContentUriAsync(downloadResult.uri);
                await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
                    data: contentUri,
                    type: 'application/pdf',
                    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
                });
            } else {
                // iOS: use sharing sheet as fallback
                if (await Sharing.isAvailableAsync()) {
                    await Sharing.shareAsync(downloadResult.uri, {
                        mimeType: 'application/pdf',
                        UTI: 'com.adobe.pdf',
                    });
                } else {
                    throw new Error('Sharing is not available on this device');
                }
            }
        } catch (err: any) {
            console.warn('PDF open error:', err);
            // Don't show error for user-cancelled intents
            if (!err?.message?.includes('cancel') && !err?.message?.includes('Cancel')) {
                setError(err?.message || 'Could not open PDF');
            }
        } finally {
            setDownloading(false);
        }
    };

    return (
        <View style={{ width, flex: 1, backgroundColor: '#0a0a0f', justifyContent: 'center', alignItems: 'center', padding: 32 }}>
            <FileText color="rgba(255,255,255,0.35)" size={80} strokeWidth={1} />
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 20, textAlign: 'center' }} numberOfLines={2}>
                {fileName}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 8, textAlign: 'center' }}>
                PDF files open in your preferred viewer app
            </Text>

            <TouchableOpacity
                style={{
                    marginTop: 28,
                    backgroundColor: theme.colors.primary,
                    paddingHorizontal: 36,
                    paddingVertical: 16,
                    borderRadius: theme.radius.card,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    opacity: downloading ? 0.7 : 1,
                }}
                onPress={openPdfExternally}
                disabled={downloading}
                activeOpacity={0.8}
            >
                {downloading ? (
                    <>
                        <ActivityIndicator color="#fff" size="small" />
                        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Downloading…</Text>
                    </>
                ) : (
                    <>
                        <FileText color="#fff" size={20} />
                        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Open PDF</Text>
                    </>
                )}
            </TouchableOpacity>

            {error && (
                <Text style={{ color: theme.colors.danger, fontSize: 13, marginTop: 16, textAlign: 'center' }}>
                    {error}
                </Text>
            )}
        </View>
    );
}

// ─────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────
export default function FilePreviewScreen({ route, navigation }: any) {
    const routeFiles = Array.isArray(route?.params?.files) ? route.params.files : [];
    const fallbackFile = route?.params?.file ?? null;
    const initialIndex: number = Number.isInteger(route?.params?.initialIndex) ? route.params.initialIndex : 0;
    const allFiles: any[] = useMemo(
        () => routeFiles.filter((f: any) => f?.mime_type !== 'inode/directory'),
        [routeFiles]
    );
    const previewData = allFiles.length > 0 ? allFiles : (fallbackFile ? [fallbackFile] : []);

    const { showToast } = useToast();

    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const [isZoomed, setIsZoomed] = useState(false); // ✅ track zoom to toggle FlatList scroll
    const file = useMemo(
        () => previewData[currentIndex] || previewData[0] || null,
        [currentIndex, previewData]
    );
    const [jwt, setJwt] = useState('');
    const [downloading, setDownloading] = useState(false);
    const { addDownload, hasActive: hasActiveDownloads } = useDownload();
    const [isStarred, setIsStarred] = useState(false);

    // Share link
    const [shareModalVisible, setShareModalVisible] = useState(false);
    const [shareToken, setShareToken] = useState('');
    const [isCreatingShare, setIsCreatingShare] = useState(false);

    // Move file
    const [moveModalVisible, setMoveModalVisible] = useState(false);
    const [folders, setFolders] = useState<any[]>([]);
    const [loadingFolders, setLoadingFolders] = useState(false);

    const openMoveModal = useCallback(async () => {
        if (!file?.id) return;
        setLoadingFolders(true);
        setMoveModalVisible(true);
        try {
            const res = await apiClient.get('/files/folders');
            if (res.data.success) {
                // Add "Root (No Folder)" as first option, then all user folders
                setFolders([
                    { id: null, name: '🏠 Root (No Folder)' },
                    ...res.data.folders,
                ]);
            }
        } catch {
            showToast('Could not load folders', 'error');
            setMoveModalVisible(false);
        } finally {
            setLoadingFolders(false);
        }
    }, [file]);

    const handleMove = useCallback(async (targetFolderId: string | null) => {
        if (!file?.id) return;
        try {
            await apiClient.post('/files/bulk', {
                ids: [file.id],
                action: 'move',
                folder_id: targetFolderId,
            });
            setMoveModalVisible(false);
            showToast('File moved successfully');
            navigation.goBack();
        } catch {
            showToast('Could not move file', 'error');
        }
    }, [file]);

    // Rename
    const [renameModalVisible, setRenameModalVisible] = useState(false);
    const [newName, setNewName] = useState('');

    useEffect(() => {
        AsyncStorage.getItem('jwtToken').then(t => setJwt(t || ''));
    }, []);

    useEffect(() => {
        setIsStarred(!!file?.is_starred);
        setNewName(file?.name || file?.file_name || '');
    }, [file?.id, file?.is_starred, file?.name, file?.file_name]);

    const handleStar = useCallback(async () => {
        if (!file?.id) return;
        try {
            await apiClient.patch(`/files/${file.id}/star`);
            setIsStarred((prev: boolean) => !prev);
            showToast(isStarred ? 'Removed from starred' : 'Added to starred');
        } catch { showToast('Failed to update star', 'error'); }
    }, [file, isStarred]);

    const handleTrash = useCallback(() => {
        if (!file?.id) return;
        Alert.alert('Move to Trash', `Move "${file.name || file.file_name}" to trash?`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Trash', style: 'destructive', onPress: async () => {
                    try {
                        await apiClient.patch(`/files/${file.id}/trash`);
                        showToast('Moved to trash');
                        navigation.goBack();
                    } catch { showToast('Failed to trash', 'error'); }
                }
            },
        ]);
    }, [file]);

    const handleDownload = useCallback(() => {
        if (!file?.id) return;
        if (!jwt) return;
        const fileName = file.name || file.file_name || 'download';
        addDownload(file.id, fileName, jwt, file.mime_type);
        showToast('Download started…');
    }, [file, jwt, addDownload, showToast]);

    const handleCreateShare = async () => {
        if (!file?.id) return;
        setIsCreatingShare(true);
        try {
            const res = await apiClient.post(`/files/${file.id}/share`, { expires_in_hours: 72 });
            if (res.data.success) {
                const link = `${API_BASE}/share/${res.data.token}`;
                setShareToken(link);
            }
        } catch { showToast('Could not create share link', 'error'); }
        finally { setIsCreatingShare(false); }
    };

    const handleCopyLink = async () => {
        await Clipboard.setStringAsync(shareToken);
        showToast('Link copied to clipboard!');
    };

    const handleRename = async () => {
        if (!file?.id) return;
        if (!newName.trim()) return;
        try {
            await apiClient.patch(`/files/${file.id}`, { file_name: newName.trim() });
            showToast('File renamed!');
            setRenameModalVisible(false);
        } catch { showToast('Rename failed', 'error'); }
    };

    // Render each slide
    const renderItem = useCallback(({ item }: { item: any }) => {
        const mime = String(item.mime_type || '').toLowerCase();
        const isImage = mime.includes('image');
        const isVideo = mime.includes('video');
        const isPdf = mime.includes('pdf');
        const isOfficeDoc = mime.includes('word') || mime.includes('excel') || mime.includes('powerpoint') || mime.includes('officedocument');
        const isDoc = isPdf || isOfficeDoc;

        const streamUrl = `${API_BASE}/stream/${item.id}`;
        const downloadUrl = `${API_BASE}/files/${item.id}/download`;
        const pdfInlineUrl = `${API_BASE}/files/${item.id}/stream`;

        if (isImage) {
            return (
                <ImagePreviewItem
                    item={item}
                    jwt={jwt}
                    isZoomed={isZoomed}
                    onZoomChange={setIsZoomed}
                />
            );
        }
        if (isVideo) {
            return (
                <View style={{ width, flex: 1, justifyContent: 'center', backgroundColor: '#0a0a0f' }}>
                    <VideoPlayer url={streamUrl} token={jwt} width={width} fileId={item.id} onError={() => {
                        showToast('Video stream failed. Try downloading instead.', 'error');
                    }} />
                </View>
            );
        }
        if (isPdf && jwt) {
            return <PdfOpenButton url={pdfInlineUrl} jwt={jwt} fileName={item.name || item.file_name || 'document.pdf'} />;
        }
        if (isOfficeDoc && jwt) {
            return (
                <View style={{ width, flex: 1, backgroundColor: theme.colors.neutral[50] }}>
                    <WebView
                        source={{ uri: downloadUrl, headers: { Authorization: `Bearer ${jwt}` } }}
                        style={{ flex: 1 }}
                        startInLoadingState={true}
                        renderLoading={() => (
                            <View style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.neutral[50] }]}>
                                <ActivityIndicator size="large" color={theme.colors.primary} />
                                <Text style={{ color: theme.colors.neutral[500], marginTop: theme.spacing.md, fontWeight: '500' }}>Loading document...</Text>
                            </View>
                        )}
                        renderError={() => (
                            <View style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.neutral[50] }]}>
                                <FileText color={theme.colors.neutral[400]} size={72} strokeWidth={1} />
                                <Text style={{ color: theme.colors.neutral[600], marginTop: theme.spacing.md, fontSize: 16 }}>Could not preview document</Text>
                                <Text style={{ color: theme.colors.neutral[500], marginTop: theme.spacing.sm, fontSize: 14 }}>Try downloading the file instead.</Text>
                            </View>
                        )}
                        onShouldStartLoadWithRequest={(request) => {
                            const url = request?.url || '';
                            if (
                                url.startsWith(API_BASE) ||
                                url.startsWith('about:blank') ||
                                url.startsWith('blob:') ||
                                url.startsWith('data:')
                            ) return true;
                            return false;
                        }}
                    />
                </View>
            );
        }
        return (
            <View style={[styles.genericPreview, { width }]}>
                <FileText color="rgba(255,255,255,0.4)" size={80} strokeWidth={1} />
                <Text style={styles.genericLabel}>{item.name || item.file_name}</Text>
                <Text style={styles.genericSub}>{item.mime_type || 'Unknown type'}</Text>
                <Text style={styles.genericSub}>Use Download to open this file</Text>
            </View>
        );
    }, [jwt, isZoomed, showToast]);

    const onViewableItemsChanged = useCallback(({ viewableItems }: any) => {
        if (viewableItems.length > 0) {
            const idx = viewableItems[0].index ?? 0;
            setCurrentIndex(idx);
        }
    }, []);

    const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

    const formatSize = (bytes: number) => {
        if (!bytes) return '—';
        const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
    };

    return (
        <SafeAreaView style={styles.container}>
            {/* Top Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.glassBtn} onPress={() => navigation.goBack()}>
                    <ArrowLeft color="#fff" size={22} />
                </TouchableOpacity>
                <View style={styles.headerActions}>
                    <TouchableOpacity style={styles.glassBtn} onPress={handleStar}>
                        <Star color={isStarred ? theme.colors.accent : '#fff'} size={20} fill={isStarred ? theme.colors.accent : 'transparent'} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.glassBtn} onPress={handleTrash}>
                        <Trash2 color={theme.colors.danger} size={20} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Preview Area — Swipeable FlatList */}
            <View style={styles.previewContainer}>
                {!jwt ? (
                    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                        <ActivityIndicator size="large" color={theme.colors.primary} />
                        <Text style={{ color: 'rgba(255,255,255,0.5)', marginTop: 12 }}>Authenticating…</Text>
                    </View>
                ) : (
                    <FlatList
                        data={previewData}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        initialScrollIndex={previewData.length > 0 ? Math.min(initialIndex, previewData.length - 1) : 0}
                        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
                        scrollEventThrottle={16}
                        keyExtractor={(item, index) => String(item?.id || index)}
                        renderItem={renderItem}
                        onViewableItemsChanged={onViewableItemsChanged}
                        viewabilityConfig={viewabilityConfig}
                        scrollEnabled={previewData.length > 1 && !isZoomed}
                        decelerationRate="fast"
                        snapToInterval={width}
                        snapToAlignment="start"
                        // ── Performance optimizations ──
                        removeClippedSubviews={true}
                        initialNumToRender={1}
                        maxToRenderPerBatch={2}
                        windowSize={3}
                    />
                )}
            </View>

            {/* Slide indicator */}
            {previewData.length > 1 && (
                <View style={styles.dotRow}>
                    {previewData.map((_, i) => (
                        <View key={i} style={[styles.dot, i === currentIndex && styles.dotActive]} />
                    ))}
                </View>
            )}

            {/* Details Bottom Sheet */}
            <View style={styles.detailSheet}>
                <Text style={styles.fileName} numberOfLines={2}>{file?.name || file?.file_name || 'Unknown file'}</Text>
                <Text style={styles.fileMeta}>
                    {formatSize(file?.size || 0)} · {file?.created_at ? new Date(file.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Unknown date'}
                </Text>

                {/* Action Row */}
                <View style={styles.actionRow}>
                    <TouchableOpacity style={styles.primaryBtn} onPress={handleDownload} disabled={downloading}>
                        {downloading ? <ActivityIndicator color="#fff" size="small" /> : <><Download color="#fff" size={20} /><Text style={styles.primaryBtnText}>Download</Text></>}
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => { setShareModalVisible(true); handleCreateShare(); }}>
                        <Link color={theme.colors.primary} size={20} />
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => setRenameModalVisible(true)}>
                        <Text style={{ fontSize: 18 }}>✏️</Text>
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.secondaryBtn} onPress={openMoveModal}>
                        <FolderInput color={theme.colors.textBody} size={20} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Share Modal */}
            <Modal visible={shareModalVisible} transparent animationType="slide">
                <View style={styles.overlay}>
                    <View style={styles.bottomSheet}>
                        <View style={styles.sheetHandle} />
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
                            <Text style={styles.sheetTitle}>🔗 Share Link</Text>
                            <TouchableOpacity onPress={() => setShareModalVisible(false)}>
                                <X color={theme.colors.textBody} size={22} />
                            </TouchableOpacity>
                        </View>
                        {isCreatingShare ? (
                            <ActivityIndicator size="large" color={theme.colors.primary} style={{ paddingVertical: 32 }} />
                        ) : shareToken ? (
                            <>
                                <View style={styles.linkBox}>
                                    <Text style={styles.linkText} numberOfLines={2} selectable>{shareToken}</Text>
                                </View>
                                <TouchableOpacity style={styles.copyBtn} onPress={handleCopyLink}>
                                    <CheckCircle color="#fff" size={18} />
                                    <Text style={styles.copyBtnText}>Copy Link</Text>
                                </TouchableOpacity>
                                <Text style={styles.linkSub}>Link expires in 72 hours · Anyone with the link can view</Text>
                            </>
                        ) : null}
                    </View>
                </View>
            </Modal>

            {/* Move Modal */}
            <Modal visible={moveModalVisible} transparent animationType="slide">
                <View style={styles.overlay}>
                    <View style={styles.bottomSheet}>
                        <View style={styles.sheetHandle} />
                        <Text style={styles.sheetTitle}>Move to Folder</Text>
                        {loadingFolders ? <ActivityIndicator size="large" color={theme.colors.primary} style={{ paddingVertical: 32 }} /> : (
                            <ScrollView style={{ maxHeight: 300 }}>
                                {folders.map(f => (
                                    <TouchableOpacity key={f.id || 'root'} style={styles.moveRow} onPress={() => handleMove(f.id)}>
                                        <Text style={styles.moveLabel}>{f.name}</Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        )}
                        <TouchableOpacity style={[styles.copyBtn, { backgroundColor: '#f1f5f9', marginTop: 12 }]} onPress={() => setMoveModalVisible(false)}>
                            <Text style={{ color: theme.colors.textHeading, fontWeight: '600' }}>Cancel</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            {/* Rename Modal */}
            <Modal visible={renameModalVisible} transparent animationType="fade">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.centeredOverlay}>
                    <View style={styles.modalCard}>
                        <Text style={styles.sheetTitle}>Rename File</Text>
                        <TextInput style={styles.renameInput} value={newName} onChangeText={setNewName} autoFocus />
                        <View style={{ flexDirection: 'row', gap: 12, justifyContent: 'flex-end' }}>
                            <TouchableOpacity style={[styles.copyBtn, { backgroundColor: '#f1f5f9', flex: 1 }]} onPress={() => setRenameModalVisible(false)}>
                                <Text style={{ color: theme.colors.textHeading, fontWeight: '600' }}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.copyBtn, { flex: 1 }]} onPress={handleRename}>
                                <Text style={styles.copyBtnText}>Rename</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0a0a0f' },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: theme.spacing.lg, zIndex: 10 },
    headerActions: { flexDirection: 'row', gap: theme.spacing.sm },
    glassBtn: { width: 44, height: 44, borderRadius: theme.radius.full, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },

    previewContainer: { flex: 1 },
    previewImage: { width: '100%', height: '100%' },
    genericPreview: { alignItems: 'center', justifyContent: 'center', padding: theme.spacing['2xl'], flex: 1 },
    genericLabel: { color: theme.colors.card, fontSize: theme.typography.title.fontSize, fontWeight: theme.typography.title.fontWeight, marginTop: theme.spacing.xl, textAlign: 'center' },
    genericSub: { color: 'rgba(255,255,255,0.5)', fontSize: theme.typography.caption.fontSize, marginTop: theme.spacing.sm },

    dotRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: theme.spacing.sm },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
    dotActive: { width: 18, backgroundColor: theme.colors.primary },

    detailSheet: { backgroundColor: theme.colors.card, borderTopLeftRadius: theme.radius.modal, borderTopRightRadius: theme.radius.modal, padding: theme.spacing.xl, paddingBottom: theme.spacing['3xl'] },
    fileName: { fontSize: theme.typography.title.fontSize, fontWeight: theme.typography.title.fontWeight, color: theme.colors.neutral[900], marginBottom: 6 },
    fileMeta: { fontSize: theme.typography.caption.fontSize, color: theme.colors.neutral[500], marginBottom: theme.spacing.xl },
    actionRow: { flexDirection: 'row', gap: theme.spacing.md },
    primaryBtn: { flex: 1, flexDirection: 'row', backgroundColor: theme.colors.primary, height: 54, borderRadius: theme.radius.card, justifyContent: 'center', alignItems: 'center', gap: theme.spacing.sm, ...theme.shadows.elevation1 },
    primaryBtnText: { color: theme.colors.card, fontSize: theme.typography.body.fontSize, fontWeight: theme.typography.hero.fontWeight },
    secondaryBtn: { width: 54, height: 54, backgroundColor: theme.colors.neutral[50], borderRadius: theme.radius.card, justifyContent: 'center', alignItems: 'center' },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    bottomSheet: { backgroundColor: theme.colors.card, borderTopLeftRadius: theme.radius.modal, borderTopRightRadius: theme.radius.modal, padding: theme.spacing.xl, paddingBottom: theme.spacing['4xl'] },
    sheetHandle: { width: 40, height: 4, backgroundColor: theme.colors.neutral[200], borderRadius: theme.radius.full, alignSelf: 'center', marginBottom: theme.spacing.xl },
    sheetTitle: { fontSize: theme.typography.title.fontSize, fontWeight: theme.typography.title.fontWeight, color: theme.colors.neutral[900], marginBottom: theme.spacing.lg },

    linkBox: { backgroundColor: theme.colors.neutral[50], borderRadius: theme.radius.md, padding: theme.spacing.lg, marginBottom: theme.spacing.lg },
    linkText: { fontSize: theme.typography.caption.fontSize, color: theme.colors.neutral[700], lineHeight: 20 },
    copyBtn: { backgroundColor: theme.colors.primary, borderRadius: theme.radius.md, height: 50, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: theme.spacing.sm },
    copyBtnText: { color: theme.colors.card, fontWeight: theme.typography.hero.fontWeight, fontSize: theme.typography.body.fontSize },
    linkSub: { fontSize: theme.typography.metadata.fontSize, color: theme.colors.neutral[500], textAlign: 'center', marginTop: theme.spacing.md },

    moveRow: { paddingVertical: theme.spacing.lg, borderBottomWidth: 1, borderBottomColor: theme.colors.neutral[100] },
    moveLabel: { fontSize: theme.typography.body.fontSize, fontWeight: theme.typography.subtitle.fontWeight, color: theme.colors.neutral[900] },

    centeredOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: theme.spacing.xl },
    modalCard: { width: '100%', backgroundColor: theme.colors.card, borderRadius: theme.radius.modal, padding: theme.spacing.xl, ...theme.shadows.elevation2 },
    renameInput: { borderWidth: 1.5, borderColor: theme.colors.neutral[200], borderRadius: theme.radius.md, paddingHorizontal: theme.spacing.lg, height: 50, fontSize: theme.typography.body.fontSize, marginBottom: theme.spacing.lg, color: theme.colors.neutral[900] },
});
