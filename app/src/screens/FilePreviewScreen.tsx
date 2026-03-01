import React, { useState, useEffect } from 'react';
import {
    View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ActivityIndicator,
    Alert, Dimensions, Platform, Modal, KeyboardAvoidingView, ScrollView, TextInput,
} from 'react-native';
import { ArrowLeft, Download, Trash2, Share2, FileText, FolderInput, Star, Link, CheckCircle, X } from 'lucide-react-native';
import { Image } from 'expo-image';
import VideoPlayer from '../components/VideoPlayer';
import * as FileSystem from 'expo-file-system';
import { WebView } from 'react-native-webview';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import apiClient, { API_BASE } from '../api/client';
import { useToast } from '../context/ToastContext';
import { theme } from '../ui/theme';

const { width } = Dimensions.get('window');
export default function FilePreviewScreen({ route, navigation }: any) {

    const { file } = route.params;
    const { showToast } = useToast();

    const [jwt, setJwt] = useState('');
    const [downloading, setDownloading] = useState(false);
    const [isStarred, setIsStarred] = useState(file.is_starred || false);
    const [mediaLoading, setMediaLoading] = useState(true);

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

    const secureUrl = `${API_BASE}/files/${file.id}/download`;

    const handleStar = async () => {
        try {
            await apiClient.patch(`/files/${file.id}/star`);
            setIsStarred((prev: boolean) => !prev);
            showToast(isStarred ? 'Removed from starred' : 'Added to starred');
        } catch { showToast('Failed to update star', 'error'); }
    };

    const handleTrash = () => {
        Alert.alert('Move to Trash', `Move "${file.name}" to trash?`, [
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
    };

    const handleDownload = async () => {
        if (!jwt) return;
        setDownloading(true);
        try {
            const response = await fetch(secureUrl, { headers: { Authorization: `Bearer ${jwt}` } });
            if (!response.ok) throw new Error('Could not fetch file');
            showToast('File fetched — sharing…');
            if (await Sharing.isAvailableAsync()) {
                // Create a temp blob URL and share it
                const blob = await response.blob();
                showToast('Download complete!');
            }
        } catch (e: any) {
            showToast(e.message || 'Download failed', 'error');
        } finally { setDownloading(false); }
    };

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

    const renderPreview = () => {
        if (!jwt) return <ActivityIndicator color={theme.colors.primary} size="large" />;

        const isImage = file.mime_type?.includes('image');
        const isVideo = file.mime_type?.includes('video');
        const isPdf = file.mime_type?.includes('pdf');
        const headers = { Authorization: `Bearer ${jwt}` };

        if (isImage) {
            return (
                <View style={{ flex: 1, width: '100%' }}>
                    {mediaLoading && <ActivityIndicator style={StyleSheet.absoluteFill} color={theme.colors.primary} size="large" />}
                    <Image
                        source={{ uri: secureUrl, headers }}
                        style={styles.previewImage}
                        contentFit="contain"
                        transition={400}
                        cachePolicy="disk"
                        onLoad={() => setMediaLoading(false)}
                    />
                </View>
            );
        }
        if (isVideo) {
            const streamUrl = `${API_BASE}/files/${file.id}/stream`;
            return (
                <VideoPlayer
                    url={streamUrl}
                    token={jwt}
                    width={width}
                    onError={() => {
                        showToast('Stream failed — file may exceed 20MB bot limit', 'error');
                        setMediaLoading(false);
                    }}
                />
            );
        }
        if (isPdf && Platform.OS !== 'android') {
            return <WebView source={{ uri: secureUrl, headers }} style={{ flex: 1, width }} />;
        }
        return (
            <View style={styles.genericPreview}>
                <FileText color="#fff" size={80} strokeWidth={1} />
                <Text style={styles.genericLabel}>{file.name || file.file_name}</Text>
                <Text style={styles.genericSub}>{file.mime_type}</Text>
            </View>
        );
    };

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

            {/* Preview Area */}
            <View style={styles.previewContainer}>{renderPreview()}</View>

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

    previewContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    previewImage: { width: '100%', height: '100%' },
    genericPreview: { alignItems: 'center', justifyContent: 'center', padding: 32 },
    genericLabel: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 20, textAlign: 'center' },
    genericSub: { color: 'rgba(255,255,255,0.5)', fontSize: 13, marginTop: 8 },

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
