/**
 * FilesScreen.tsx – Folder browser (list view of all folders with file counts)
 */
import React, { useState, useEffect, useContext, useCallback, useMemo, useRef } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView, FlatList,
    TouchableOpacity, ActivityIndicator, RefreshControl,
    TextInput, Dimensions,
} from 'react-native';
import {
    ArrowLeft, Folder, Search, X, MoreHorizontal, Plus
} from 'lucide-react-native';
import { AuthContext } from '../context/AuthContext';
import apiClient from '../services/apiClient';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import { FileCardSkeleton } from '../ui/Skeleton';
import { EmptyState } from '../ui/EmptyState';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFileRefresh } from '../utils/events';

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
    headerTitle: { fontSize: 24, fontWeight: '700', color: C.text },
    editBtn: {
        marginLeft: 'auto',
        fontSize: 14,
        fontWeight: '600',
        color: C.primary,
    },
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
    folderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderBottomWidth: 1,
        borderBottomColor: C.border,
        gap: 14,
    },
    folderIcon: {
        width: 50,
        height: 50,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: C.primarySoft,
    },
    folderInfo: {
        flex: 1,
    },
    folderName: {
        fontSize: 15,
        fontWeight: '700',
        color: C.text,
        marginBottom: 4,
    },
    folderCount: {
        fontSize: 12,
        fontWeight: '500',
        color: C.muted,
    },
    listPad: { paddingVertical: 12 },
});

export default function FilesScreen({ navigation }: any) {
    const { token } = useContext(AuthContext);
    const { showToast } = useToast();
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();

    const C = useMemo(() => ({
        bg: theme.colors.background,
        card: theme.colors.card,
        primary: theme.colors.primary,
        primarySoft: isDark ? 'rgba(88,117,255,0.16)' : '#EEF1FD',
        text: theme.colors.textHeading,
        muted: theme.colors.textBody,
        border: theme.colors.border,
    }), [theme.colors, isDark]);

    const s = useMemo(() => createStyles(C), [C]);

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [folders, setFolders] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const mountedRef = useRef(true);

    const fetchFolders = useCallback(async () => {
        setLoading(true);
        try {
            const res = await apiClient.get('/files/folders');
            if (mountedRef.current && res.data.success) {
                setFolders(res.data.folders || []);
            }
        } catch {
            if (mountedRef.current) showToast('Could not load folders', 'error');
        } finally {
            if (mountedRef.current) {
                setLoading(false);
                setRefreshing(false);
            }
        }
    }, [showToast]);

    useEffect(() => {
        fetchFolders();
        return () => {
            mountedRef.current = false;
        };
    }, [fetchFolders]);

    useFileRefresh(() => {
        fetchFolders();
    });

    const filteredFolders = useMemo(() => {
        if (!searchQuery.trim()) return folders;
        const q = searchQuery.toLowerCase();
        return folders.filter(f => (f.name || '').toLowerCase().includes(q));
    }, [folders, searchQuery]);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchFolders();
    }, [fetchFolders]);

    const renderFolder = useCallback(({ item }: any) => (
        <TouchableOpacity
            style={s.folderRow}
            onPress={() => navigation.navigate('FolderFiles', { folderId: item.id, folderName: item.name })}
            activeOpacity={0.6}
        >
            <View style={[s.folderIcon, { backgroundColor: C.primarySoft }]}>
                <Folder color={C.primary} size={24} fill={C.primary} />
            </View>
            <View style={s.folderInfo}>
                <Text style={s.folderName} numberOfLines={1}>{item.name}</Text>
                <Text style={s.folderCount}>
                    {item.file_count || 0} file{item.file_count !== 1 ? 's' : ''}
                </Text>
            </View>
            <MoreHorizontal color={C.muted} size={20} />
        </TouchableOpacity>
    ), [C, navigation, s]);

    return (
        <SafeAreaView style={[s.container, { paddingTop: Math.max(insets.top, 0) }]}>
            {/* Header */}
            <View style={s.header}>
                <Text style={s.headerTitle}>Files</Text>
                <TouchableOpacity onPress={() => showToast('Edit mode coming soon')}>
                    <Text style={s.editBtn}>Edit</Text>
                </TouchableOpacity>
            </View>

            {/* Search */}
            <View style={s.searchBar}>
                <Search size={18} color={C.muted} />
                <TextInput
                    style={[s.searchInput, { color: C.text }]}
                    placeholder="Search"
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
            ) : filteredFolders.length === 0 ? (
                <EmptyState
                    title={searchQuery ? 'No results found' : 'No folders yet'}
                    description={searchQuery ? 'Try a different keyword' : 'Create a folder to get started'}
                    iconType="folder"
                    style={{ paddingVertical: 80, flex: 0 }}
                />
            ) : (
                <FlatList
                    data={filteredFolders}
                    keyExtractor={item => item.id}
                    renderItem={renderFolder}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
                    scrollEnabled
                    showsVerticalScrollIndicator={false}
                />
            )}
        </SafeAreaView>
    );
}
