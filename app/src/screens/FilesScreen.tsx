import React, { useState, useEffect, useContext } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView, FlatList,
    TouchableOpacity, ActivityIndicator, RefreshControl
} from 'react-native';
import { ArrowLeft, HardDrive, Filter, Search } from 'lucide-react-native';
import { AuthContext } from '../context/AuthContext';
import apiClient from '../api/client';
import FileCard from '../components/FileCard';
import { useToast } from '../context/ToastContext';
import { theme } from '../ui/theme';

export default function FilesScreen({ navigation }: any) {
    const { token } = useContext(AuthContext);
    const { showToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [files, setFiles] = useState<any[]>([]);

    useEffect(() => { fetchFiles(); }, []);

    const fetchFiles = async () => {
        try {
            const res = await apiClient.get('/files?limit=100&sort=created_at&order=DESC');
            if (res.data.success) {
                setFiles(res.data.files);
            }
        } catch (e) {
            showToast('Could not load files', 'error');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
                    <ArrowLeft color={theme.colors.textHeading} size={24} />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle}>All Files</Text>
                    <Text style={styles.headerSub}>Sorted by recent</Text>
                </View>
                <TouchableOpacity style={styles.searchBtn} onPress={() => navigation.navigate('Home', { autoFocusSearch: true })}>
                    <Search color={theme.colors.textHeading} size={22} />
                </TouchableOpacity>
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={theme.colors.primary} />
                </View>
            ) : files.length === 0 ? (
                <View style={styles.center}>
                    <HardDrive color="#cbd5e1" size={48} />
                    <Text style={styles.emptyText}>No files uploaded yet</Text>
                </View>
            ) : (
                <FlatList
                    data={files}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={styles.list}
                    renderItem={({ item }) => (
                        <FileCard
                            item={item}
                            token={token || undefined}
                            apiBase={apiClient.defaults.baseURL}
                            onPress={() => navigation.navigate('FilePreview', { file: item })}
                        />
                    )}
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchFiles(); }} tintColor={theme.colors.primary} />
                    }
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f4f6fb' },
    header: {
        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20,
        height: 60, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f0f0f0'
    },
    backBtn: { width: 40, height: 40, justifyContent: 'center' },
    headerTitleContainer: { flex: 1, marginLeft: 10 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: theme.colors.textHeading },
    headerSub: { fontSize: 12, color: theme.colors.textBody, marginTop: 1 },
    searchBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-end' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    list: { padding: 20 },
    emptyText: { marginTop: 15, fontSize: 16, color: '#6e778d', fontWeight: '500' }
});
