import React, { useState, useEffect, useContext } from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, TouchableOpacity } from 'react-native';
import { ArrowLeft, Star } from 'lucide-react-native';
import apiClient from '../api/client';
import { useToast } from '../context/ToastContext';
import { AuthContext } from '../context/AuthContext';
import { theme } from '../ui/theme';
import FileCard from '../components/FileCard';
import { FileCardSkeleton } from '../ui/Skeleton';

export default function StarredScreen({ navigation }: any) {
    const { showToast } = useToast();
    const { token } = useContext(AuthContext);
    const [isLoading, setIsLoading] = useState(true);
    const [files, setFiles] = useState<any[]>([]);

    useEffect(() => { fetchStarred(); }, []);

    const fetchStarred = async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get('/files/starred');
            if (res.data.success) setFiles(res.data.files);
        } catch { showToast('Could not load starred files', 'error'); }
        finally { setIsLoading(false); }
    };

    const handleStar = async (id: string) => {
        try {
            await apiClient.patch(`/files/${id}/star`);
            setFiles(prev => prev.filter(f => f.id !== id));
            showToast('Removed from starred');
        } catch { showToast('Failed to update star', 'error'); }
    };

    const handleTrash = async (id: string) => {
        try {
            await apiClient.patch(`/files/${id}/trash`);
            showToast('Moved to trash');
            setFiles(prev => prev.filter(f => f.id !== id));
        } catch { showToast('Failed', 'error'); }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()}>
                    <ArrowLeft color={theme.colors.textHeading} size={24} />
                </TouchableOpacity>
                <Text style={styles.title}>⭐ Starred Files</Text>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
                {isLoading ? [1, 2, 3].map(i => <FileCardSkeleton key={i} />) : (
                    files.length === 0 ? (
                        <View style={styles.empty}>
                            <Star color="#cbd5e1" size={52} />
                            <Text style={styles.emptyTitle}>No starred files</Text>
                            <Text style={styles.emptySub}>Tap the ⭐ on any file to star it</Text>
                        </View>
                    ) : (
                        files.map(f => (
                            <FileCard
                                key={f.id}
                                item={f}
                                onPress={() => navigation.navigate('FilePreview', { file: f })}
                                onStar={() => handleStar(f.id)}
                                onTrash={() => handleTrash(f.id)}
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
    header: { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 14 },
    title: { fontSize: 22, fontWeight: '700', color: theme.colors.textHeading },
    content: { paddingHorizontal: 20, paddingTop: 8 },
    empty: { alignItems: 'center', paddingTop: 80 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.textHeading, marginTop: 16, marginBottom: 8 },
    emptySub: { fontSize: 14, color: theme.colors.textBody },
});
