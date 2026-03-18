import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    FlatList,
    TouchableOpacity,
    RefreshControl,
    Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { ArrowLeft, Clock, Eye, Download, Link as LinkIcon, Trash2, Folder, File as FileIcon } from 'lucide-react-native';
import apiClient from '../services/apiClient';
import { revokeShareLink } from '../services/api';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { ErrorState } from '../ui/ErrorState';
import { buildExternalShareUrl, normalizeExternalShareUrl } from '../utils/shareUrls';

function formatDistanceToNow(date: Date, opts?: { addSuffix?: boolean }): string {
    const now = Date.now();
    const diff = Math.abs(now - date.getTime());
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);

    let result: string;
    if (seconds < 60) result = 'less than a minute';
    else if (minutes < 60) result = `${minutes} minute${minutes > 1 ? 's' : ''}`;
    else if (hours < 24) result = `${hours} hour${hours > 1 ? 's' : ''}`;
    else if (days < 30) result = `${days} day${days > 1 ? 's' : ''}`;
    else result = `${months} month${months > 1 ? 's' : ''}`;

    if (opts?.addSuffix) {
        return date.getTime() < now ? `${result} ago` : `in ${result}`;
    }
    return result;
}

const createStyles = (theme: any, C: any) =>
    StyleSheet.create({
        container: { flex: 1 },
        header: {
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 20,
            paddingVertical: 16,
            borderBottomWidth: 1,
            borderBottomColor: C.border,
            gap: 12,
        },
        backBtn: {
            width: 40,
            height: 40,
            justifyContent: 'center',
        },
        headerInfo: { flex: 1 },
        title: { fontSize: 24, fontWeight: '700' },
        subtitle: { fontSize: 12, marginTop: 2, fontWeight: '500' },
        center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
        list: { padding: 20, gap: 16 },
        card: {
            borderRadius: 16,
            padding: 16,
            borderWidth: 1,
            borderColor: C.border,
            ...theme.shadows.elevation1,
        },
        cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
        iconBox: {
            width: 40,
            height: 40,
            borderRadius: 10,
            backgroundColor: C.primaryLight,
            justifyContent: 'center',
            alignItems: 'center',
        },
        itemName: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
        itemDate: { fontSize: 13 },
        expiredBadge: {
            backgroundColor: C.danger + '22',
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 12,
        },
        expiredText: { color: C.danger, fontSize: 11, fontWeight: '600' },
        statsRow: { flexDirection: 'row', gap: 16, marginBottom: 16, flexWrap: 'wrap' },
        stat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
        statText: { fontSize: 13, fontWeight: '500' },
        actions: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 16 },
        actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44 },
        actionText: { fontSize: 14, fontWeight: '600' },
        divider: { width: 1, height: '100%' },
        empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 16 },
        emptyText: { fontSize: 18, fontWeight: '600' },
        emptySub: { fontSize: 14, textAlign: 'center' },
    });

export default function SharedLinksScreen({ navigation }: any) {
    const { theme } = useTheme();
    const C = theme.colors;
    const insets = useSafeAreaInsets();
    const styles = useMemo(() => createStyles(theme, C), [theme, C]);
    const { showToast } = useToast();
    const [links, setLinks] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [loadError, setLoadError] = useState('');

    const fetchLinks = async () => {
        setIsLoading(true);
        setLoadError('');
        try {
            const res = await apiClient.get('/api/v2/shares');
            if (res.data.success) {
                setLinks(res.data.shares || []);
            }
        } catch (e: any) {
            const message = e?.response?.data?.error || 'Could not load shared links right now.';
            setLoadError(message);
            showToast(message, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        void fetchLinks();
        const unsubscribe = navigation.addListener('focus', () => {
            void fetchLinks();
        });
        return unsubscribe;
    }, [navigation]);

    const handleCopy = async (shareUrl: string) => {
        await Clipboard.setStringAsync(shareUrl);
        showToast('Link copied to clipboard', 'success');
    };

    const handleRevoke = (token: string) => {
        Alert.alert('Revoke Link', 'Are you sure you want to delete this shared link? Anyone with the link will lose access immediately.', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Revoke',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await revokeShareLink(token);
                        showToast('Share link revoked', 'success');
                        void fetchLinks();
                    } catch (e: any) {
                        showToast(e?.response?.data?.error || 'Failed to revoke link.', 'error');
                    }
                },
            },
        ]);
    };

    const renderItem = ({ item }: { item: any }) => {
        const isFolder = String(item.resourceType || '').toLowerCase() === 'folder';
        const name = isFolder ? 'Shared Folder' : 'Shared File';
        const createdAt = item.createdAt || item.created_at;
        const expiresAt = item.expiresAt || item.expires_at;
        const shareUrl = normalizeExternalShareUrl(
            String(item.share_url || item.shareUrl || buildExternalShareUrl(item.slug || '', item.secret || ''))
        ).trim();
        const isExpired = expiresAt ? new Date(expiresAt) < new Date() : false;

        return (
            <TouchableOpacity
                activeOpacity={0.9}
                style={[styles.card, { backgroundColor: C.card }]}
                onPress={() => navigation.navigate('SharedLinkDetail', { shareId: item.id, initialShare: item })}
            >
                <View style={styles.cardHeader}>
                    <View style={styles.iconBox}>
                        {isFolder ? <Folder color={C.accent} size={20} /> : <FileIcon color={C.primary} size={20} />}
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.itemName, { color: C.textHeading }]} numberOfLines={1}>
                            {name}
                        </Text>
                        <Text style={[styles.itemDate, { color: C.textBody }]}>
                            Created {formatDistanceToNow(new Date(createdAt || Date.now()), { addSuffix: true })}
                        </Text>
                    </View>
                    {isExpired && (
                        <View style={styles.expiredBadge}>
                            <Text style={styles.expiredText}>Expired</Text>
                        </View>
                    )}
                </View>

                <View style={styles.statsRow}>
                    <View style={styles.stat}>
                        <Eye color={C.textBody} size={14} />
                        <Text style={[styles.statText, { color: C.textBody }]}>{item.views || 0} views</Text>
                    </View>
                    <View style={styles.stat}>
                        <Download color={C.textBody} size={14} />
                        <Text style={[styles.statText, { color: C.textBody }]}>{item.download_count || 0} dl</Text>
                    </View>
                    {expiresAt && !isExpired && (
                        <View style={styles.stat}>
                            <Clock color={C.textBody} size={14} />
                            <Text style={[styles.statText, { color: C.textBody }]}>{formatDistanceToNow(new Date(expiresAt))} left</Text>
                        </View>
                    )}
                    {!!item.fileCount && (
                        <View style={styles.stat}>
                            <FileIcon color={C.textBody} size={14} />
                            <Text style={[styles.statText, { color: C.textBody }]}>{item.fileCount} files</Text>
                        </View>
                    )}
                </View>

                <View style={[styles.actions, { borderTopColor: C.border }]}>
                    <TouchableOpacity
                        style={styles.actionBtn}
                        disabled={!shareUrl}
                        onPress={(e: any) => {
                            e?.stopPropagation?.();
                            void handleCopy(shareUrl);
                        }}
                    >
                        <LinkIcon color={C.primary} size={16} />
                        <Text style={[styles.actionText, { color: shareUrl ? C.primary : C.textBody }]}>{shareUrl ? 'Copy Link' : 'Link unavailable'}</Text>
                    </TouchableOpacity>
                    <View style={[styles.divider, { backgroundColor: C.border }]} />
                    <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={(e: any) => {
                            e?.stopPropagation?.();
                            handleRevoke(item.id);
                        }}
                    >
                        <Trash2 color={C.danger} size={16} />
                        <Text style={[styles.actionText, { color: C.danger }]}>Revoke</Text>
                    </TouchableOpacity>
                </View>
            </TouchableOpacity>
        );
    };

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        fetchLinks().finally(() => setRefreshing(false));
    }, []);

    return (
        <View style={[styles.container, { backgroundColor: C.background, paddingTop: insets.top }]}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
                    <ArrowLeft color={C.textHeading} size={24} />
                </TouchableOpacity>
                <View style={styles.headerInfo}>
                    <Text style={[styles.title, { color: C.textHeading }]} numberOfLines={1}>Shared Links</Text>
                    <Text style={[styles.subtitle, { color: C.textBody }]} numberOfLines={1}>
                        {links.length} link{links.length !== 1 ? 's' : ''}
                    </Text>
                </View>
            </View>

            {isLoading && links.length === 0 ? (
                <View style={styles.center}>
                    <View style={{ padding: 20 }}>
                        {[1, 2, 3].map(i => (
                            <View key={i} style={{ height: 120, borderRadius: 16, backgroundColor: C.card, marginBottom: 16, opacity: 0.5 }} />
                        ))}
                    </View>
                </View>
            ) : loadError && links.length === 0 ? (
                <ErrorState title="Could not load shared links" message={loadError} onRetry={() => void fetchLinks()} />
            ) : (
                <FlatList
                    data={links}
                    keyExtractor={item => item.id}
                    renderItem={renderItem}
                    contentContainerStyle={styles.list}
                    refreshControl={
                        <RefreshControl
                            refreshing={refreshing}
                            tintColor={C.primary}
                            onRefresh={onRefresh}
                        />
                    }
                    windowSize={10}
                    maxToRenderPerBatch={15}
                    removeClippedSubviews
                    ListEmptyComponent={
                        <View style={styles.empty}>
                            <LinkIcon color={C.textBody} size={48} />
                            <Text style={[styles.emptyText, { color: C.textHeading }]}>No Active Links</Text>
                            <Text style={[styles.emptySub, { color: C.textBody }]}>Files and folders you share will appear here.</Text>
                        </View>
                    }
                />
            )}
        </View>
    );
}
