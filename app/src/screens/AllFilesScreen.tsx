/**
 * AllFilesScreen.tsx – Shows all individual files across all folders
 */
import React, { useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView, FlatList,
    TouchableOpacity, ActivityIndicator, RefreshControl,
    TextInput, Dimensions,
} from 'react-native';
import {
    ArrowLeft, Search, X
} from 'lucide-react-native';
import { AuthContext } from '../context/AuthContext';
import apiClient from '../services/apiClient';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import { FileCardSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import FileListItem from '../components/FileListItem';
import FileQuickActions from '../components/FileQuickActions';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFileRefresh, useOptimisticFiles } from '../utils/events';
import { dedupeFilesById, sortFilesLatestFirst } from '../services/fileStateSync';

const { width } = Dimensions.get('window');

const createStyles = (C: any) => StyleSheet.create({
    container: { flex: 1, backgroundColor: C.bg },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 16,
        backgroundColor: C.bg,
        borderBottomWidth: 1,
        borderBottomColor: C.border,
        gap: 12,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        gap: 12,
    },
    headerTitle: { fontSize: 24, fontWeight: '700', color: C.text },
    headerSub: { fontSize: 12, color: C.muted, marginTop: 2, fontWeight: '500' },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: C.card,
        borderRadius: 12,
        paddingHorizontal: 14,
        height: 46,
        marginHorizontal: 20,
        marginVertical: 12,
        gap: 10,
        borderWidth: 1,
        borderColor: C.border,
    },
    searchInput: {
        flex: 1,
        fontSize: 15,
        color: C.text,
    },
    listPad: { paddingVertical: 12, paddingHorizontal: 20 },
});

export default function AllFilesScreen({ navigation }: any) {
    const { token } = useContext(AuthContext);
    const { showToast } = useToast();
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();

    const C = useMemo(() => ({
        bg: theme.colors.background,
        card: theme.colors.card,
        primary: theme.colors.primary,
        text: theme.colors.textHeading,
        muted: theme.colors.textBody,
        border: theme.colors.border,
    }), [theme.colors, isDark]);

    const s = useMemo(() => createStyles(C), [C]);

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [files, setFiles] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [optionsTarget, setOptionsTarget] = useState<any>(null);
    const mountedRef = useRef(true);

    const fetchFiles = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiClient.get('/files?limit=1000&sort=created_at&order=DESC');
            if (mountedRef.current && res.data.success) {
                setFiles(sortFilesLatestFirst(dedupeFilesById(res.data.files || [])));
            }
        } catch {
            if (mountedRef.current) showToast('Could not load files', 'error');
        } finally {
            if (mountedRef.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, [showToast]);

    useEffect(() => {
        fetchFiles();
        return () => {
            mountedRef.current = false;
        };
    }, [fetchFiles]);

    useFileRefresh(() => {
        fetchFiles();
    });

    useOptimisticFiles(setFiles);

    const filteredFiles = useMemo(() => {
        if (!searchQuery.trim()) return files;
        const q = searchQuery.toLowerCase();
        return files.filter(f => (f.file_name || f.name || '').toLowerCase().includes(q));
    }, [files, searchQuery]);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchFiles();
    }, [fetchFiles]);

    const renderFile = useCallback(({ item }: any) => (
        <FileListItem
            item={item}
            token={token}
            apiBaseUrl={apiClient.defaults.baseURL || ''}
            theme={theme}
            isDark={isDark}
            onPress={() => {
                const idx = filteredFiles.findIndex(f => f.id === item.id);
                navigation.navigate('FilePreview', { files: filteredFiles, initialIndex: idx === -1 ? 0 : idx });
            }}
            onOptionsPress={(item) => setOptionsTarget(item)}
        />
    ), [filteredFiles, navigation, theme, isDark, token]);

    return (
        <SafeAreaView style={[s.container, { paddingTop: Math.max(insets.top, 0) }]}>
            {/* Header */}
            <View style={s.header}>
                <View style={s.headerLeft}>
                    <Text style={s.headerTitle}>All Files</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[s.headerSub, { marginTop: 0, marginBottom: -2 }]}>
                        {files.length} items
                    </Text>
                </View>
            </View>

            {/* Search */}
            <View style={s.searchBar}>
                <Search size={18} color={C.muted} />
                <TextInput
                    style={[s.searchInput, { color: C.text }]}
                    placeholder="Search or filter (e.g. 'images last week')"
                    placeholderTextColor={C.muted}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                />
                {searchQuery ? (
                    <TouchableOpacity onPress={() => setSearchQuery('')}>
                        <X size={18} color={C.muted} />
                    </TouchableOpacity>
                ) : null}
            </View>

            {/* List */}
            {loading ? (
                <View style={s.listPad}>
                    {[1, 2, 3, 4, 5].map(i => <FileCardSkeleton key={i} />)}
                </View>
            ) : filteredFiles.length === 0 ? (
                <EmptyState
                    title={searchQuery ? 'No results found' : 'No files yet'}
                    description={searchQuery ? 'Try a different keyword' : 'Upload files to get started'}
                    iconType="file"
                    style={{ paddingVertical: 80, flex: 0 }}
                />
            ) : (
                <FlatList
                    data={filteredFiles}
                    keyExtractor={item => item.id}
                    renderItem={renderFile}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
                    scrollEnabled
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: 0 }}
                />
            )}

            {/* File Quick Actions Modal */}
            <FileQuickActions 
                item={optionsTarget} 
                visible={!!optionsTarget} 
                onClose={() => setOptionsTarget(null)} 
                onRefresh={fetchFiles} 
            />

        </SafeAreaView>
    );
}
