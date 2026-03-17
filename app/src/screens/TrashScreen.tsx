import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView,
    TouchableOpacity, ActivityIndicator, Animated, FlatList,
    RefreshControl, Alert
} from 'react-native';
import { ArrowLeft, Trash2, AlertTriangle } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import apiClient from '../services/apiClient';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import FileCard from '../components/FileCard';
import { FileCardSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useFileRefresh } from '../utils/events';
import { dedupeFilesById, sortFilesLatestFirst, syncAfterFileMutation } from '../services/fileStateSync';
import { sanitizeDisplayName } from '../utils/fileSafety';

export default function TrashScreen({ navigation }: any) {
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    const { showToast } = useToast();
    const { token } = useAuth();

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
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

    useFileRefresh(() => {
        void loadTrash();
    });

    const deletedCountLabel = useMemo(() => {
        return files.length === 1 ? '1 file' : `${files.length} files`;
    }, [files.length]);

    const handleRestore = useCallback(async (item: any) => {
        try {
            await apiClient.patch(`/files/${item.id}/restore`);
            setFiles((prev) => prev.filter((file) => file.id !== item.id));
            syncAfterFileMutation();
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
                            syncAfterFileMutation();
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
                        try {
                            await apiClient.delete('/files/trash');
                            setFiles([]);
                            syncAfterFileMutation();
                            showToast('Trash emptied');
                        } catch {
                            showToast('Could not empty trash', 'error');
                        }
                    },
                },
            ]
        );
    }, [files.length, showToast]);

    const handleBack = useCallback(() => {
        if (navigation?.canGoBack?.()) {
            navigation.goBack();
            return;
        }
        navigation?.navigate?.('MainTabs', { screen: 'Home' });
    }, [navigation]);

    const renderItem = useCallback(({ item }: { item: any }) => {
        return (
            <View style={st.cardWrap}>
                <FileCard
                    item={item}
                    onPress={() => {}}
                    onRestore={() => void handleRestore(item)}
                    onTrash={() => handleDeleteForever(item)}
                    showRestore
                    token={token || ''}
                    apiBase={apiClient.defaults.baseURL}
                />
            </View>
        );
    }, [handleDeleteForever, handleRestore, token]);

    const BG_COLOR = isDark ? '#0A0A0F' : '#F9FBFF';
    const CARD_BG = isDark ? '#14141E' : '#FFFFFF';
    const TEXT_MAIN = isDark ? '#FFFFFF' : '#0F172A';
    const TEXT_SUB = isDark ? '#94A3B8' : '#64748B';
    const BORDER = isDark ? '#1F1F2E' : '#E2E8F0';

    return (
        <SafeAreaView style={[st.root, { backgroundColor: BG_COLOR }]}>
            <View style={[st.header, { backgroundColor: BG_COLOR, paddingTop: Math.max(insets.top + 8, 16) }]}>
                <TouchableOpacity style={st.headerBtn} onPress={handleBack} activeOpacity={0.7}>
                    <ArrowLeft color={TEXT_MAIN} size={24} strokeWidth={2.5} />
                </TouchableOpacity>
                <View style={st.headerCopy}>
                    <Text style={[st.headerTitle, { color: TEXT_MAIN }]}>Trash</Text>
                    <Text style={[st.headerSub, { color: TEXT_SUB }]}>{deletedCountLabel}</Text>
                </View>
                <TouchableOpacity
                    style={[st.headerBtn, st.headerAction]}
                    activeOpacity={files.length === 0 ? 1 : 0.7}
                    disabled={files.length === 0}
                    onPress={handleEmptyTrash}
                >
                    <Text style={{ color: files.length === 0 ? BORDER : TEXT_SUB, fontWeight: '700' }}>Empty</Text>
                </TouchableOpacity>
            </View>

            {loading ? (
                <View style={st.loaderView}>
                    <View style={st.skeletonWrap}>
                        {[1, 2, 3].map((key) => (
                            <FileCardSkeleton key={key} />
                        ))}
                    </View>
                </View>
            ) : (
                <Animated.View style={[st.content, { opacity: fadeAnim }]}> 
                    <View style={[st.infoCard, { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.1)' : '#FFFBEB', borderColor: isDark ? '#451A03' : '#FEF3C7' }]}>
                        <AlertTriangle color="#F59E0B" size={20} />
                        <Text style={[st.infoText, { color: isDark ? '#FCD34D' : '#92400E' }]}>Files in trash are automatically deleted after 30 days.</Text>
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
                            renderItem={renderItem}
                            showsVerticalScrollIndicator={false}
                            contentContainerStyle={st.list}
                            refreshControl={
                                <RefreshControl
                                    refreshing={refreshing}
                                    tintColor={theme.colors.primary}
                                    onRefresh={() => {
                                        setRefreshing(true);
                                        void loadTrash();
                                    }}
                                />
                            }
                        />
                    )}
                </Animated.View>
            )}
        </SafeAreaView>
    );
}

const st = StyleSheet.create({
    root: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 16, zIndex: 10,
    },
    headerBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start' },
    headerCopy: { flex: 1, marginLeft: 8 },
    headerSub: { fontSize: 12, fontWeight: '500', marginTop: 2 },
    headerAction: { width: 72, alignItems: 'flex-end' },
    headerTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
    loaderView: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    skeletonWrap: { width: '100%', paddingHorizontal: 20 },
    content: { flex: 1 },
    list: { paddingHorizontal: 20, paddingBottom: 32 },
    
    infoCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        gap: 12,
        marginHorizontal: 20,
        marginTop: 8,
        marginBottom: 20,
    },
    infoText: {
        flex: 1,
        fontSize: 14,
        fontWeight: '500',
        lineHeight: 20,
    },

    cardWrap: {
        marginBottom: 6,
    },
    emptyState: {
        flex: 1,
        paddingHorizontal: 20,
        paddingBottom: 56,
    },
});
