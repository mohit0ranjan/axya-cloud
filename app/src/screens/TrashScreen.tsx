import React, { useState, useEffect, useContext } from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, TouchableOpacity, Alert } from 'react-native';
import { ArrowLeft, Trash } from 'lucide-react-native';
import apiClient from '../api/client';
import { useToast } from '../context/ToastContext';
import { AuthContext } from '../context/AuthContext';
import { theme } from '../ui/theme';
import FileCard from '../components/FileCard';
import { FileCardSkeleton } from '../ui/Skeleton';

export default function TrashScreen({ navigation }: any) {
    const { showToast } = useToast();
    const { token } = useContext(AuthContext);
    const [isLoading, setIsLoading] = useState(true);
    const [files, setFiles] = useState<any[]>([]);

    useEffect(() => { fetchTrash(); }, []);

    const fetchTrash = async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get('/files/trash');
            if (res.data.success) setFiles(res.data.files);
        } catch { showToast('Could not load trash', 'error'); }
        finally { setIsLoading(false); }
    };

    const handleRestore = async (id: string) => {
        try {
            await apiClient.patch(`/files/${id}/restore`);
            showToast('File restored!');
            setFiles(prev => prev.filter(f => f.id !== id));
        } catch { showToast('Failed to restore', 'error'); }
    };

    const handleDelete = async (id: string) => {
        Alert.alert('Permanent Delete', 'This will permanently delete the file and remove it from Telegram. This cannot be undone.', [
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
        Alert.alert('Empty Trash', `Permanently delete all ${files.length} files in trash?`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Empty Trash', style: 'destructive', onPress: async () => {
                    try {
                        await Promise.all(files.map(f => apiClient.delete(`/files/${f.id}`)));
                        showToast('Trash emptied');
                        setFiles([]);
                    } catch { showToast('Error emptying trash', 'error'); }
                }
            },
        ]);
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.back} onPress={() => navigation.goBack()}>
                    <ArrowLeft color={theme.colors.textHeading} size={24} />
                </TouchableOpacity>
                <Text style={styles.title}>Trash</Text>
                {files.length > 0 && (
                    <TouchableOpacity style={styles.emptyBtn} onPress={handleEmptyTrash}>
                        <Text style={styles.emptyText}>Empty</Text>
                    </TouchableOpacity>
                )}
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
                {isLoading ? [1, 2, 3].map(i => <FileCardSkeleton key={i} />) : (
                    files.length === 0 ? (
                        <View style={styles.empty}>
                            <Trash color="#cbd5e1" size={52} />
                            <Text style={styles.emptyTitle}>Trash is empty</Text>
                            <Text style={styles.emptySub}>Files moved to trash appear here</Text>
                        </View>
                    ) : (
                        files.map(f => (
                            <FileCard
                                key={f.id}
                                item={f}
                                onPress={() => { }}
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
    container: { flex: 1, backgroundColor: theme.colors.background },
    header: { flexDirection: 'row', alignItems: 'center', padding: 20, paddingBottom: 12 },
    back: { marginRight: 12 },
    title: { fontSize: 22, fontWeight: '700', color: theme.colors.textHeading, flex: 1 },
    emptyBtn: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: 'rgba(251,78,78,0.1)', borderRadius: 10 },
    emptyText: { color: theme.colors.danger, fontWeight: '700', fontSize: 14 },
    content: { paddingHorizontal: 20, paddingTop: 8 },
    empty: { alignItems: 'center', paddingTop: 80 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.textHeading, marginTop: 16, marginBottom: 8 },
    emptySub: { fontSize: 14, color: theme.colors.textBody },
});
