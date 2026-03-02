import React, { useState, useEffect, useContext } from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, TouchableOpacity, Alert, RefreshControl } from 'react-native';
import { ArrowLeft, Trash } from 'lucide-react-native';
import apiClient from '../services/apiClient';
import { useToast } from '../context/ToastContext';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import FileCard from '../components/FileCard';
import { FileCardSkeleton } from '../ui/Skeleton';

export default function TrashScreen({ navigation }: any) {
    const { showToast } = useToast();
    const { token } = useContext(AuthContext);
    const { theme } = useTheme();
    const [isLoading, setIsLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [files, setFiles] = useState<any[]>([]);

    useEffect(() => { fetchTrash(); }, []);

    const fetchTrash = async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get('/files/trash');
            if (res.data.success) setFiles(res.data.files);
        } catch { showToast('Could not load trash', 'error'); }
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

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.content}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        tintColor={C.primary}
                        onRefresh={() => { setRefreshing(true); fetchTrash(); }}
                    />
                }
            >
                {isLoading ? [1, 2, 3].map(i => <FileCardSkeleton key={i} />) : (
                    files.length === 0 ? (
                        <View style={styles.empty}>
                            <Trash color="#cbd5e1" size={52} />
                            <Text style={[styles.emptyTitle, { color: C.textHeading }]}>Trash is empty</Text>
                            <Text style={[styles.emptySub, { color: C.textBody }]}>Files moved to trash appear here</Text>
                        </View>
                    ) : (
                        files.map(f => (
                            <FileCard
                                key={f.id}
                                item={f}
                                onPress={() => navigation.navigate('FilePreview', {
                                    files,
                                    initialIndex: files.findIndex(x => x.id === f.id),
                                    file: f,
                                })}
                                onTrash={() => handleDelete(f.id)}
                                showRestore
                                onRestore={() => handleRestore(f.id)}
                                token={token || ''}
                                apiBase={apiClient.defaults.baseURL}
                            />
                        ))

                    )
                )}
                <View style={{ height: 40 }} />
            </ScrollView>
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
    empty: { alignItems: 'center', paddingTop: 80 },
    emptyTitle: { fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 },
    emptySub: { fontSize: 14 },
});
