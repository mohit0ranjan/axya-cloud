/**
 * TrashScreen.tsx — Trash files using FileListItem for consistency
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View, Text, StyleSheet,
    TouchableOpacity, Animated, FlatList,
    RefreshControl, Alert
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
    const [files, setFiles] = useState<any[]>([]);

    const fadeAnim = useRef(new Animated.Value(0)).current;

    const loadTrash = useCallback(async () => {
        try {
            const res = await apiClient.get('/files/trash');
            if (res.data?.success) {
                setFiles(sortFilesLatestFirst(dedupeFilesById(res.data.files || [])));
            } else {
                setFiles([]);
            }
        } catch {
            showToast('Could not load trash', 'error');
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

    const handleRestore = useCallback(async (item: any) => {
        try {
            await apiClient.patch(`/files/${item.id}/restore`);
            setFiles((prev) => prev.filter((file) => file.id !== item.id));
            syncAfterFileMutation({ clearCache: true });
            showToast('File restored');
        } catch {
            showToast('Could not restore file', 'error');
        }
    }, [showToast]);

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
                        try {
                            await apiClient.delete(`/files/${item.id}`);
                            setFiles((prev) => prev.filter((file) => file.id !== item.id));
                            syncAfterFileMutation({ clearCache: true });
                            showToast('File deleted permanently');
                        } catch {
                            showToast('Could not delete file', 'error');
                        }
                    },
                },
            ]
        );
    }, [showToast]);

    const handleEmptyTrash = useCallback(() => {
        if (files.length === 0) return;
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
                        try {
                            const res = await apiClient.delete('/files/trash');
                            if (res.data?.success) {
                                showToast(res.data.warning || res.data.message || 'Trash emptied');
                            }
                        } catch (err: any) {
                            showToast(err.response?.data?.error || 'Could not empty trash completely', 'error');
                        } finally {
                            setIsEmptying(false);
                            void loadTrash();
                            syncAfterFileMutation({ clearCache: true });
                        }
                    },
                },
            ]
        );
    }, [files.length, showToast]);

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
                    activeOpacity={files.length === 0 || isEmptying ? 1 : 0.7}
                    disabled={files.length === 0 || isEmptying}
                    onPress={handleEmptyTrash}
                >
                    <Text style={{ color: files.length === 0 ? C.border : '#EF4444', fontWeight: '700', fontSize: 14 }}>
                        {isEmptying ? 'Emptying...' : 'Empty'}
                    </Text>
                </TouchableOpacity>
            </View>

            {loading ? (
                <View style={{ padding: 20 }}>
                    {[0, 1, 2, 3].map((key) => <FileCardSkeleton key={key} index={key} />)}
                </View>
            ) : (
                <Animated.View style={[st.content, { opacity: fadeAnim }]}> 
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
                                    onPress={() => {}} 
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
    emptyState: { flex: 1, paddingHorizontal: 20, paddingBottom: 56 },
});
