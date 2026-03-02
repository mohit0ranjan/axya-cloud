import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator,
    Alert, Dimensions, Platform, Modal, KeyboardAvoidingView, ScrollView, TextInput,
    FlatList, Animated, PanResponder,
} from 'react-native';
import { ArrowLeft, Download, Trash2, FileText, FolderInput, Star, Link, CheckCircle, X } from 'lucide-react-native';

import { Image } from 'expo-image';
import VideoPlayer from '../components/VideoPlayer';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient, { API_BASE } from '../api/client';
import { useToast } from '../context/ToastContext';
import { theme } from '../ui/theme';

const { width, height } = Dimensions.get('window');

// ─────────────────────────────────────────────────────────────
// ImagePreviewItem — own loading/error state per image
// This is the key fix: each FlatList slide has its own state
// ─────────────────────────────────────────────────────────────
function ImagePreviewItem({ item, jwt }: { item: any; jwt: string }) {
    const [loading, setLoading] = useState(true);
    const [useFallback, setUseFallback] = useState(false);
    const [errored, setErrored] = useState(false);

    const thumbUrl = `${API_BASE}/files/${item.id}/thumbnail`;
    const downloadUrl = `${API_BASE}/files/${item.id}/download`;
    const headers = { Authorization: `Bearer ${jwt}` };
    const src = useFallback ? downloadUrl : thumbUrl;

    return (
        <View style={{ width, flex: 1, backgroundColor: '#0a0a0f', justifyContent: 'center', alignItems: 'center' }}>
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
                <View style={{ alignItems: 'center', padding: 32 }}>
                    <FileText color="rgba(255,255,255,0.3)" size={72} strokeWidth={1} />
                    <Text style={{ color: 'rgba(255,255,255,0.5)', marginTop: 16, fontSize: 14 }}>Could not load image</Text>
                </View>
            ) : (
                <Image
                    source={{ uri: src, headers }}
                    style={{ width, height: height * 0.65 }}
                    contentFit="contain"
                    transition={300}
                    cachePolicy="disk"
                    onLoad={() => setLoading(false)}
                    onError={() => {
                        if (!useFallback) {
                            // Thumbnail failed → try full download URL
                            setUseFallback(true);
                            setLoading(true);
                        } else {
                            // Both failed
                            setLoading(false);
                            setErrored(true);
                        }
                    }}
                />
            )}
        </View>
    );
}

// ─────────────────────────────────────────────────────────────
// Main Screen
// ─────────────────────────────────────────────────────────────
export default function FilePreviewScreen({ route, navigation }: any) {

    const allFiles: any[] = useMemo(() =>
        (route.params.files || []).filter((f: any) => f.mime_type !== 'inode/directory'),
        [route.params.files]
    );
    const initialIndex: number = route.params.initialIndex ?? 0;

    const { showToast } = useToast();

    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const file = useMemo(() => allFiles[currentIndex] || route.params.file, [currentIndex, allFiles]);
    const [jwt, setJwt] = useState('');
    const [downloading, setDownloading] = useState(false);
    const [isStarred, setIsStarred] = useState(file?.is_starred || false);

    // Share link
    const [shareModalVisible, setShareModalVisible] = useState(false);
    const [shareToken, setShareToken] = useState('');
    const [isCreatingShare, setIsCreatingShare] = useState(false);

    // Move file
    const [moveModalVisible, setMoveModalVisible] = useState(false);
    const [folders, setFolders] = useState<any[]>([]);
    const [loadingFolders, setLoadingFolders] = useState(false);

    // Rename
    const [renameModalVisible, setRenameModalVisible] = useState(false);
    const [newName, setNewName] = useState(file.name || file.file_name || '');

    useEffect(() => {
        AsyncStorage.getItem('jwtToken').then(t => setJwt(t || ''));
    }, []);

    const handleStar = useCallback(async () => {
        try {
            await apiClient.patch(`/files/${file.id}/star`);
            setIsStarred((prev: boolean) => !prev);
            showToast(isStarred ? 'Removed from starred' : 'Added to starred');
        } catch { showToast('Failed to update star', 'error'); }
    }, [file, isStarred]);

    const handleTrash = useCallback(() => {
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

    const handleDownload = useCallback(async () => {
        if (!jwt) return;
        setDownloading(true);
        try {
            const fileName = file.name || file.file_name || 'download';
            const cacheDir = FileSystem.documentDirectory ?? '/tmp/';
            const localUri = cacheDir + fileName;
            showToast('Downloading…');

            const downloadResult = await FileSystem.downloadAsync(
                `${API_BASE}/files/${file.id}/download`,
                localUri,
                { headers: { Authorization: `Bearer ${jwt}` } }
            );

            if (downloadResult.status !== 200) throw new Error('Server returned ' + downloadResult.status);

            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(downloadResult.uri, { mimeType: file.mime_type });
            } else {
                showToast('File saved: ' + fileName);
            }
        } catch (e: any) {
            showToast(e.message || 'Download failed', 'error');
        } finally { setDownloading(false); }
    }, [file, jwt]);

    const handleCreateShare = async () => {
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
        if (!newName.trim()) return;
        try {
            await apiClient.patch(`/files/${file.id}`, { file_name: newName.trim() });
            showToast('File renamed!');
            setRenameModalVisible(false);
        } catch { showToast('Rename failed', 'error'); }
    };

    const handleMove = async (folderId: string | null) => {
        try {
            await apiClient.patch(`/files/${file.id}`, { folder_id: folderId });
            showToast('File moved!');
            setMoveModalVisible(false);
            navigation.goBack();
        } catch { showToast('Move failed', 'error'); }
    };

    const openMoveModal = async () => {
        setMoveModalVisible(true);
        setLoadingFolders(true);
        try {
            const res = await apiClient.get('/files/folders');
            if (res.data.success) {
                setFolders([{ id: null, name: '📂 Root (Top Level)' }, ...res.data.folders]);
            }
        } catch { } finally { setLoadingFolders(false); }
    };

    // Render each slide
    const renderItem = useCallback(({ item }: { item: any }) => {
        const isImage = item.mime_type?.includes('image');
        const isVideo = item.mime_type?.includes('video');
        const streamUrl = `${API_BASE}/files/${item.id}/stream`;

        if (isImage) {
            return <ImagePreviewItem item={item} jwt={jwt} />;
        }
        if (isVideo) {
            return (
                <View style={{ width, flex: 1, justifyContent: 'center', backgroundColor: '#0a0a0f' }}>
                    <VideoPlayer url={streamUrl} token={jwt} width={width} onError={() => {
                        showToast('Video stream failed. Try downloading instead.', 'error');
                    }} />
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
    }, [jwt]);

    const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
        if (viewableItems.length > 0) {
            const idx = viewableItems[0].index ?? 0;
            setCurrentIndex(idx);
            setIsStarred(allFiles[idx]?.is_starred || false);
        }
    }).current;

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
                        data={allFiles.length > 0 ? allFiles : [file]}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        initialScrollIndex={Math.min(initialIndex, Math.max(0, allFiles.length - 1))}
                        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
                        scrollEventThrottle={16}
                        keyExtractor={(item) => String(item.id)}
                        renderItem={renderItem}
                        onViewableItemsChanged={onViewableItemsChanged}
                        viewabilityConfig={viewabilityConfig}
                        // Disable scroll if there's only 1 file
                        scrollEnabled={allFiles.length > 1}
                        decelerationRate="fast"
                        snapToInterval={width}
                        snapToAlignment="start"
                    />
                )}
            </View>

            {/* Slide indicator */}
            {allFiles.length > 1 && (
                <View style={styles.dotRow}>
                    {allFiles.map((_, i) => (
                        <View key={i} style={[styles.dot, i === currentIndex && styles.dotActive]} />
                    ))}
                </View>
            )}

            {/* Details Bottom Sheet */}
            <View style={styles.detailSheet}>
                <Text style={styles.fileName} numberOfLines={2}>{file.name || file.file_name}</Text>
                <Text style={styles.fileMeta}>
                    {formatSize(file.size)} · {new Date(file.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
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
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, zIndex: 10 },
    headerActions: { flexDirection: 'row', gap: 10 },
    glassBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', justifyContent: 'center', alignItems: 'center' },

    previewContainer: { flex: 1 },
    previewImage: { width: '100%', height: '100%' },
    genericPreview: { alignItems: 'center', justifyContent: 'center', padding: 32, flex: 1 },
    genericLabel: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 20, textAlign: 'center' },
    genericSub: { color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 8 },

    dotRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingVertical: 8 },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
    dotActive: { width: 18, backgroundColor: theme.colors.primary },

    detailSheet: { backgroundColor: '#fff', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 28, paddingBottom: 36 },
    fileName: { fontSize: 20, fontWeight: '700', color: theme.colors.textHeading, marginBottom: 6 },
    fileMeta: { fontSize: 13, color: theme.colors.textBody, marginBottom: 24 },
    actionRow: { flexDirection: 'row', gap: 12 },
    primaryBtn: { flex: 1, flexDirection: 'row', backgroundColor: theme.colors.primary, height: 54, borderRadius: 16, justifyContent: 'center', alignItems: 'center', gap: 8, shadowColor: theme.colors.primary, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
    primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
    secondaryBtn: { width: 54, height: 54, backgroundColor: '#f1f5f9', borderRadius: 16, justifyContent: 'center', alignItems: 'center' },

    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    bottomSheet: { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 28, paddingBottom: 44 },
    sheetHandle: { width: 40, height: 4, backgroundColor: '#e2e8f0', borderRadius: 2, alignSelf: 'center', marginBottom: 24 },
    sheetTitle: { fontSize: 20, fontWeight: '700', color: theme.colors.textHeading, marginBottom: 20 },

    linkBox: { backgroundColor: '#f8f9fc', borderRadius: 14, padding: 16, marginBottom: 16 },
    linkText: { fontSize: 13, color: theme.colors.textBody, lineHeight: 20 },
    copyBtn: { backgroundColor: theme.colors.primary, borderRadius: 14, height: 50, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
    copyBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    linkSub: { fontSize: 12, color: theme.colors.textBody, textAlign: 'center', marginTop: 12 },

    moveRow: { paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
    moveLabel: { fontSize: 15, fontWeight: '600', color: theme.colors.textHeading },

    centeredOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    modalCard: { width: '100%', backgroundColor: '#fff', borderRadius: 24, padding: 24 },
    renameInput: { borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: 12, paddingHorizontal: 16, height: 50, fontSize: 15, marginBottom: 20, color: theme.colors.textHeading },
});
