import React, { useState, useEffect, useContext, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, SafeAreaView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { ArrowLeft, Trash } from 'lucide-react-native';
import apiClient from '../services/apiClient';
import { useToast } from '../context/ToastContext';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import FileCard from '../components/FileCard';
import { FileCardSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';

export default function TrashScreen({ navigation }: any) {
    const { showToast } = useToast();
    const { token } = useContext(AuthContext);
    const { theme } = useTheme();
    const [isLoading, setIsLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [files, setFiles] = useState<any[]>([]);
    const [loadError, setLoadError] = useState<string | null>(null);

    const normalizeTrashFiles = useCallback((input: any): any[] => {
        if (!Array.isArray(input)) return [];
        return input
            .map((row, index) => {
                if (!row || typeof row !== 'object') return null;
                const rawId = row.id ?? row.file_id;
                if (!rawId) return null;
                const name = typeof row.name === 'string' ? row.name : row.file_name;
                if (!name || typeof name !== 'string') return null;
                const createdAtMs = new Date(row.created_at).getTime();
                const createdAt = Number.isFinite(createdAtMs) ? row.created_at : new Date().toISOString();
                return {
                    ...row,
                    id: String(rawId),
                    name,
                    file_name: row.file_name || name,
                    size: Number.isFinite(Number(row.size)) ? Number(row.size) : 0,
                    created_at: createdAt,
                    _fallbackKey: `trash-${index}`,
                };
            })
            .filter(Boolean);
    }, []);

    useEffect(() => { fetchTrash(); }, []);

    const fetchTrash = async () => {
        setIsLoading(true);
        setLoadError(null);
        try {
            const res = await apiClient.get('/files/trash');
            if (res.data?.success) {
                const safeFiles = normalizeTrashFiles(res.data?.files);
                setFiles(safeFiles);
                return;
            }
            throw new Error(res.data?.error || 'Unexpected trash response');
        } catch {
            setFiles([]);
            setLoadError('Could not load trash right now');
            showToast('Could not load trash', 'error');
        }
        finally { setIsLoading(false); setRefreshing(false); }
    };

    const handleRestore = async (id: string) => {
        try {
            await apiClient.patch(`/files/${id}/restore`);
            showToast('File restored!');
            setFiles(prev => prev.filter(f => f.id !== id));
        } catch { showToast('Failed to restore', 'error'); }
    };

    const handleDelete = async (id: string) => {
        Alert.alert('Permanent Delete', 'This will permanently delete the file from Telegram. Cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete', style: 'destructive', onPress: async () => {
                    try {
                        await apiClient.delete(`/files/${id}`);
                        showToast('File permanently deleted');
                        setFiles(prev => prev.filter(f => f.id !== id));
                    } catch { showToast('Failed to delete', 'error'); }
                }
            },
        ]);
    };

    const handleEmptyTrash = () => {
        Alert.alert('Empty Trash', `Permanently delete all ${files.length} files?`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Empty Trash', style: 'destructive', onPress: async () => {
                    try {
                        await apiClient.delete('/files/trash');
                        showToast('Trash emptied');
                        setFiles([]);
                    } catch { showToast('Error emptying trash', 'error'); }
                }
            },
        ]);
    };

    const C = theme.colors;

    const renderItem = useCallback(({ item: f }: { item: any }) => (
        <FileCard
            item={f}
            onPress={() => navigation.navigate('FilePreview', {
                files,
                initialIndex: Math.max(files.findIndex(x => x.id === f.id), 0),
                file: f,
            })}
            onTrash={() => handleDelete(f.id)}
            showRestore
            onRestore={() => handleRestore(f.id)}
            token={token || ''}
            apiBase={apiClient.defaults.baseURL}
        />
    ), [files, token]);

    const keyExtractor = useCallback((item: any, index: number) => item?.id || item?._fallbackKey || `trash-item-${index}`, []);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: C.background }]}>
            <View style={[styles.header, { backgroundColor: C.background }]}>
                <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
                    <ArrowLeft color={C.textHeading} size={24} />
                </TouchableOpacity>
                <Text style={[styles.title, { color: C.textHeading }]}>Trash</Text>
                {files.length > 0 && (
                    <TouchableOpacity style={[styles.emptyBtn, { backgroundColor: 'rgba(251,78,78,0.1)' }]} onPress={handleEmptyTrash}>
                        <Text style={[styles.emptyText, { color: C.danger }]}>Empty</Text>
                    </TouchableOpacity>
                )}
            </View>

            {isLoading ? (
                <View style={styles.content}>
                    {[1, 2, 3].map(i => <FileCardSkeleton key={i} />)}
                </View>
            ) : loadError ? (
                <EmptyState
                    title="Trash unavailable"
                    description={loadError}
                    iconType="error"
                    buttonText="Try Again"
                    onButtonPress={fetchTrash}
                    style={{ paddingVertical: 80, flex: 1 }}
                />
            ) : files.length === 0 ? (
                <EmptyState
                    title="Trash is empty"
                    description="Files moved to trash appear here"
                    iconType="file"
                    style={{ paddingVertical: 80, flex: 1 }}
                />
            ) : (
                <FlatList
                    data={files}
                    keyExtractor={keyExtractor}
                    renderItem={renderItem}
                    contentContainerStyle={styles.content}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            tintColor={C.primary}
                            onRefresh={() => { setRefreshing(true); fetchTrash(); }}
                        />
                    }
                    ListFooterComponent={<View style={{ height: 40 }} />}
                    removeClippedSubviews={true}
                    maxToRenderPerBatch={10}
                    windowSize={7}
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingBottom: 12 },
    back: { marginRight: 12 },
    title: { fontSize: 22, fontWeight: '700', flex: 1 },
    emptyBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
    emptyText: { fontWeight: '700', fontSize: 14 },
    content: { paddingHorizontal: 20, paddingTop: 8 },
});
