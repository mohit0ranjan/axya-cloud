import React, { useState, useEffect, useContext } from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, TouchableOpacity, RefreshControl, Alert } from 'react-native';

import { ArrowLeft, Star } from 'lucide-react-native';
import apiClient from '../services/apiClient';
import { useToast } from '../context/ToastContext';
import { AuthContext } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import FileCard from '../components/FileCard';
import { FileCardSkeleton } from '../ui/Skeleton';

export default function StarredScreen({ navigation }: any) {
    const { showToast } = useToast();
    const { token } = useContext(AuthContext);
    const { theme } = useTheme();
    const [isLoading, setIsLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [files, setFiles] = useState<any[]>([]);

    useEffect(() => { fetchStarred(); }, []);

    const fetchStarred = async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get('/files/starred');
            if (res.data.success) setFiles(res.data.files);
        } catch { showToast('Could not load starred files', 'error'); }
        finally { setIsLoading(false); setRefreshing(false); }
    };

    const handleStar = async (id: string) => {
        try {
            await apiClient.patch(`/files/${id}/star`);
            setFiles(prev => prev.filter(f => f.id !== id));
            showToast('Removed from starred');
        } catch { showToast('Failed to update star', 'error'); }
    };

    const handleTrash = (id: string, name: string) => {
        Alert.alert('Move to Trash', `Move "${name}" to trash?`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Move to Trash', style: 'destructive', onPress: async () => {
                    try {
                        await apiClient.patch(`/files/${id}/trash`);
                        showToast('Moved to trash');
                        setFiles(prev => prev.filter(f => f.id !== id));
                    } catch { showToast('Failed', 'error'); }
                }
            }
        ]);
    };


    const C = theme.colors;

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: C.background }]}>
            <View style={[styles.header, { backgroundColor: C.background }]}>
                <TouchableOpacity onPress={() => navigation.goBack()}>
                    <ArrowLeft color={C.textHeading} size={24} />
                </TouchableOpacity>
                <Text style={[styles.title, { color: C.textHeading }]}>⭐ Starred Files</Text>
            </View>

            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.content}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        tintColor={C.primary}
                        onRefresh={() => { setRefreshing(true); fetchStarred(); }}
                    />
                }
            >
                {isLoading ? [1, 2, 3].map(i => <FileCardSkeleton key={i} />) : (
                    files.length === 0 ? (
                        <View style={styles.empty}>
                            <Star color="#cbd5e1" size={52} />
                            <Text style={[styles.emptyTitle, { color: C.textHeading }]}>No starred files</Text>
                            <Text style={[styles.emptySub, { color: C.textBody }]}>Tap the ⭐ on any file to star it</Text>
                        </View>
                    ) : (
                        files.map((f, idx) => (
                            <FileCard
                                key={f.id}
                                item={f}
                                onPress={() => {
                                    apiClient.patch(`/files/${f.id}/accessed`).catch(() => { });
                                    navigation.navigate('FilePreview', { files, initialIndex: idx });
                                }}
                                onStar={() => handleStar(f.id)}
                                onTrash={() => handleTrash(f.id, f.file_name || f.name || 'this file')}

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
    header: { flexDirection: 'row', alignItems: 'center', padding: 20, gap: 14 },
    title: { fontSize: 22, fontWeight: '700' },
    content: { paddingHorizontal: 20, paddingTop: 8 },
    empty: { alignItems: 'center', paddingTop: 80 },
    emptyTitle: { fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 },
    emptySub: { fontSize: 14 },
});
