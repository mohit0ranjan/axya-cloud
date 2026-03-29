/**
 * TrashScreen.tsx — Trash files using FileListItem for consistency
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View, Text, StyleSheet,
    TouchableOpacity, Animated, FlatList,
    RefreshControl, Alert, ActivityIndicator
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, AlertTriangle } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import apiClient from '../services/apiClient';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import FileListItem from '../components/FileListItem';
import { FileCardSkeleton, ContentFadeIn } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { ErrorState } from '../ui/ErrorState';
import { useFileRefresh } from '../utils/events';
import { dedupeFilesById, sortFilesLatestFirst, syncAfterFileMutation } from '../services/fileStateSync';
import { sanitizeDisplayName } from '../utils/fileSafety';

export default function TrashScreen({ navigation }: any) {
    const { theme, isDark } = useTheme();
    const C = theme.colors;
    const insets = useSafeAreaInsets();
    const { showToast } = useToast();
    const { token } = useAuth();

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [isEmptying, setIsEmptying] = useState(false);
    const [pendingActionId, setPendingActionId] = useState<string | null>(null);
    const [loadError, setLoadError] = useState('');
    const [files, setFiles] = useState<any[]>([]);

    const fadeAnim = useRef(new Animated.Value(0)).current;

    const loadTrash = useCallback(async () => {
        setLoadError('');
        try {
            const res = await apiClient.get('/files/trash');
            if (res.data?.success) {
                setFiles(sortFilesLatestFirst(dedupeFilesById(res.data.files || [])));
            } else {
                setFiles([]);
                setLoadError(res.data?.error || 'Could not load trash.');
            }
        } catch (err: any) {
            const message = err?.response?.data?.error || 'Could not load trash. Check your connection and retry.';
            setLoadError(message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [showToast]);

    useEffect(() => {
        Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
        void loadTrash();
    }, [fadeAnim, loadTrash]);

    useFileRefresh(() => { void loadTrash(); });

    const deletedCountLabel = useMemo(() => {
        return files.length === 1 ? '1 file' : `${files.length} files`;
    }, [files.length]);

    const isBusy = isEmptying || pendingActionId !== null;

    const handleRestore = useCallback(async (item: any) => {
        setPendingActionId(item.id);
        try {
            const res = await apiClient.patch(`/files/${item.id}/restore`);
            if (!res.data?.success) throw new Error(res.data?.error || 'Could not restore file');
            setFiles((prev) => prev.filter((file) => file.id !== item.id));
            syncAfterFileMutation({ clearCache: true });
            await loadTrash();
            showToast('File restored');
        } catch (err: any) {
            const message = err?.response?.data?.error || err?.message || 'Could not restore file';
            setLoadError(message);
            showToast(message, 'error');
            await loadTrash();
        } finally {
            setPendingActionId(null);
        }
    }, [loadTrash, showToast]);

    const handleDeleteForever = useCallback((item: any) => {
        const label = sanitizeDisplayName(item.name || item.file_name || 'this file', 'this file');
        Alert.alert(
            'Delete permanently',
            `Delete "${label}" permanently? This cannot be undone.`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        setPendingActionId(item.id);
                        try {
                            const res = await apiClient.post('/files/bulk', { ids: [item.id], action: 'delete' });
                            if (!res.data?.success) throw new Error(res.data?.error || 'Could not delete file');
                            setFiles((prev) => prev.filter((file) => file.id !== item.id));
                            syncAfterFileMutation({ clearCache: true });
                            await loadTrash();
                            showToast('File deleted permanently');
                        } catch (err: any) {
                            const message = err?.response?.data?.error || err?.message || 'Could not delete file';
                            setLoadError(message);
                            showToast(message, 'error');
                            await loadTrash();
                        } finally {
                            setPendingActionId(null);
                        }
                    },
                },
            ]
        );
    }, [loadTrash, showToast]);

    const handleEmptyTrash = useCallback(() => {
        if (files.length === 0 || isBusy) return;
        Alert.alert(
            'Empty trash',
            'Delete all trashed files permanently? This cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Empty trash',
                    style: 'destructive',
                    onPress: async () => {
                        setIsEmptying(true);
                        setLoadError('');
                        try {
                            const res = await apiClient.delete('/files/trash');
                            if (res.data?.success) {
                                setFiles([]);
                                syncAfterFileMutation({ clearCache: true });
                                await loadTrash();
                                showToast(res.data.message || 'Trash emptied');
                            } else {
                                throw new Error(res.data?.error || 'Could not empty trash completely');
                            }
                        } catch (err: any) {
                            const message = err?.response?.data?.error || err?.message || 'Could not empty trash completely';
                            setLoadError(message);
                            showToast(message, 'error');
                            await loadTrash();
                        } finally {
                            setIsEmptying(false);
                        }
                    },
                },
            ]
        );
    }, [files.length, isEmptying, loadTrash, showToast]);

    const handleBack = useCallback(() => {
        if (navigation?.canGoBack?.()) { navigation.goBack(); return; }
        navigation?.navigate?.('MainTabs', { screen: 'Home' });
    }, [navigation]);

    // Show trash-specific options inline (Restore + Delete Forever)
    const handleTrashOptions = useCallback((item: any) => {
        const label = sanitizeDisplayName(item.name || item.file_name || 'File', 'File');
        Alert.alert(label, 'Choose an action', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Restore', onPress: () => void handleRestore(item) },
            { text: 'Delete Forever', style: 'destructive', onPress: () => handleDeleteForever(item) },
        ]);
    }, [handleRestore, handleDeleteForever]);

    return (
        <View style={[st.root, { backgroundColor: C.background, paddingTop: insets.top }]}>
            {/* Header — matches AllFiles/Starred pattern */}
            <View style={[st.header, { backgroundColor: C.background, borderBottomColor: C.border }]}>
                <TouchableOpacity style={st.iconBtn} onPress={handleBack} activeOpacity={0.7}>
                    <ArrowLeft color={C.textHeading} size={24} />
                </TouchableOpacity>
                <View style={st.headerInfo}>
                    <Text style={[st.headerTitle, { color: C.textHeading }]} numberOfLines={1}>Trash</Text>
                    <Text style={[st.headerSub, { color: C.textBody }]} numberOfLines={1}>{deletedCountLabel}</Text>
                </View>
                <TouchableOpacity
                    style={st.emptyBtn}
                    activeOpacity={files.length === 0 || isBusy ? 1 : 0.7}
                    disabled={files.length === 0 || isBusy}
                    onPress={handleEmptyTrash}
                >
                    {isBusy ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <ActivityIndicator size="small" color="#EF4444" />
                            <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 14 }}>
                                {isEmptying ? 'Emptying' : 'Working'}
                            </Text>
                        </View>
                    ) : (
                        <Text style={{ color: files.length === 0 ? C.border : '#EF4444', fontWeight: '700', fontSize: 14 }}>
                            Empty
                        </Text>
                    )}
                </TouchableOpacity>
            </View>

            {loading ? (
                <View style={{ padding: 20 }}>
                    {[0, 1, 2, 3].map((key) => <FileCardSkeleton key={key} index={key} />)}
                </View>
            ) : loadError && files.length === 0 ? (
                <ErrorState title="Trash unavailable" message={loadError} onRetry={() => { setLoading(true); void loadTrash(); }} />
            ) : (
                <Animated.View style={[st.content, { opacity: fadeAnim }]}> 
                    {loadError && files.length > 0 && (
                        <View style={[st.errorBanner, { backgroundColor: C.card, borderColor: C.danger + '33' }]}>
                            <Text style={[st.errorBannerText, { color: C.danger }]} numberOfLines={2}>{loadError}</Text>
                            <TouchableOpacity onPress={() => { setRefreshing(true); void loadTrash(); }}>
                                <Text style={{ color: C.primary, fontWeight: '700' }}>Retry</Text>
                            </TouchableOpacity>
                        </View>
                    )}

                    {/* Warning Banner */}
                    <View style={[st.infoCard, { backgroundColor: isDark ? 'rgba(245,158,11,0.1)' : '#FFFBEB', borderColor: isDark ? '#451A03' : '#FEF3C7' }]}>
                        <AlertTriangle color="#F59E0B" size={20} />
                        <Text style={[st.infoText, { color: isDark ? '#FCD34D' : '#92400E' }]}>
                            Files in trash are automatically deleted after 30 days.
                        </Text>
                    </View>

                    {files.length === 0 ? (
                        <EmptyState
                            title="Trash is empty"
                            description="Deleted files will appear here until you restore them or empty the trash."
                            iconType="file"
                            style={st.emptyState}
                        />
                    ) : (
                        <FlatList
                            data={files}
                            keyExtractor={(item) => String(item.id)}
                            renderItem={({ item }) => (
                                <FileListItem
                                    item={item}
                                    token={token || ''}
                                    apiBaseUrl={apiClient.defaults.baseURL || ''}
                                    theme={theme}
                                    isDark={isDark}
                                    onPress={() => handleTrashOptions(item)}
                                    onOptionsPress={handleTrashOptions}
                                />
                            )}
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={st.list}
                            refreshControl={
                                <RefreshControl
                                    refreshing={refreshing}
                                    tintColor={C.primary}
                                    onRefresh={() => {
                                        setRefreshing(true);
                                        void loadTrash();
                                    }}
                                />
                            }
                            windowSize={10}
                            maxToRenderPerBatch={20}
                            removeClippedSubviews
                        />
                    )}
                </Animated.View>
            )}
        </View>
    );
}

const st = StyleSheet.create({
    root: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 20, paddingVertical: 16,
        borderBottomWidth: 1, gap: 12,
    },
    iconBtn: { width: 40, height: 40, justifyContent: 'center' },
    headerInfo: { flex: 1 },
    headerTitle: { fontSize: 24, fontWeight: '700' },
    headerSub: { fontSize: 12, fontWeight: '500', marginTop: 2 },
    emptyBtn: { paddingHorizontal: 12, height: 34, justifyContent: 'center' },
    content: { flex: 1 },
    list: { paddingHorizontal: 20, paddingBottom: 32 },
    infoCard: {
        flexDirection: 'row', alignItems: 'center',
        padding: 16, borderRadius: 16, borderWidth: 1, gap: 12,
        marginHorizontal: 20, marginTop: 8, marginBottom: 20,
    },
    infoText: { flex: 1, fontSize: 14, fontWeight: '500', lineHeight: 20 },
    errorBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderRadius: 16,
        borderWidth: 1,
        marginHorizontal: 20,
        marginTop: 8,
        marginBottom: 12,
    },
    errorBannerText: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18 },
    emptyState: { flex: 1, paddingHorizontal: 20, paddingBottom: 56 },
});
