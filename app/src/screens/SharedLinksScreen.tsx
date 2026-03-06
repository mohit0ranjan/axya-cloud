import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView, FlatList,
    TouchableOpacity, ActivityIndicator, Alert
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { ArrowLeft, Clock, Eye, Download, Link as LinkIcon, Trash2, Folder, File as FileIcon } from 'lucide-react-native';
import apiClient from '../services/apiClient';
import { revokeShareLink } from '../services/api';
import { useTheme } from '../context/ThemeContext';

// Lightweight replacement for date-fns formatDistanceToNow
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

export default function SharedLinksScreen({ navigation }: any) {
    const { theme } = useTheme();
    const [links, setLinks] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const fetchLinks = async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get('/api/share');
            if (res.data.success) {
                setLinks(res.data.links || []);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchLinks();
    }, []);

    const handleCopy = async (shareUrl: string) => {
        await Clipboard.setStringAsync(shareUrl);
        Alert.alert('Copied!', 'Link copied to clipboard.');
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
                        fetchLinks();
                    } catch (e) {
                        Alert.alert('Error', 'Failed to revoke link.');
                    }
                }
            }
        ]);
    };

    const renderItem = ({ item }: { item: any }) => {
        const isFolder = !!item.folder_id;
        const name = item.folder_name || item.file_name || 'Unknown Item';
        const isExpired = item.expires_at ? new Date(item.expires_at) < new Date() : false;

        return (
            <View style={[styles.card, { backgroundColor: theme.colors.card }]}>
                <View style={styles.cardHeader}>
                    <View style={styles.iconBox}>
                        {isFolder ? <Folder color="#D97706" size={20} /> : <FileIcon color={theme.colors.primary} size={20} />}
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.itemName, { color: theme.colors.textHeading }]} numberOfLines={1}>{name}</Text>
                        <Text style={[styles.itemDate, { color: theme.colors.textBody }]}>
                            Created {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
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
                        <Eye color={theme.colors.textBody} size={14} />
                        <Text style={[styles.statText, { color: theme.colors.textBody }]}>{item.views || 0} views</Text>
                    </View>
                    <View style={styles.stat}>
                        <Download color={theme.colors.textBody} size={14} />
                        <Text style={[styles.statText, { color: theme.colors.textBody }]}>{item.download_count || 0} dl</Text>
                    </View>
                    {item.expires_at && !isExpired && (
                        <View style={styles.stat}>
                            <Clock color={theme.colors.textBody} size={14} />
                            <Text style={[styles.statText, { color: theme.colors.textBody }]}>
                                {formatDistanceToNow(new Date(item.expires_at))} left
                            </Text>
                        </View>
                    )}
                </View>

                <View style={[styles.actions, { borderTopColor: theme.colors.border }]}>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => void handleCopy(String(item.share_url || item.shareUrl || ''))}>
                        <LinkIcon color={theme.colors.primary} size={16} />
                        <Text style={[styles.actionText, { color: theme.colors.primary }]}>Copy Link</Text>
                    </TouchableOpacity>
                    <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
                    <TouchableOpacity style={styles.actionBtn} onPress={() => handleRevoke(item.id)}>
                        <Trash2 color={theme.colors.danger} size={16} />
                        <Text style={[styles.actionText, { color: theme.colors.danger }]}>Revoke</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft color={theme.colors.textHeading} size={24} />
                </TouchableOpacity>
                <Text style={[styles.title, { color: theme.colors.textHeading }]}>Shared Links</Text>
                <View style={{ width: 40 }} />
            </View>

            {isLoading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={theme.colors.primary} />
                </View>
            ) : (
                <FlatList
                    data={links}
                    keyExtractor={item => item.id}
                    renderItem={renderItem}
                    contentContainerStyle={styles.list}
                    ListEmptyComponent={
                        <View style={styles.empty}>
                            <LinkIcon color={theme.colors.textBody} size={48} />
                            <Text style={[styles.emptyText, { color: theme.colors.textHeading }]}>No Active Links</Text>
                            <Text style={[styles.emptySub, { color: theme.colors.textBody }]}>Files and folders you share will appear here.</Text>
                        </View>
                    }
                />
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
    backBtn: { padding: 4 },
    title: { fontSize: 20, fontWeight: '700' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    list: { padding: 20, gap: 16 },
    card: { borderRadius: 16, padding: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8 },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
    iconBox: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center' },
    itemName: { fontSize: 16, fontWeight: '600', marginBottom: 2 },
    itemDate: { fontSize: 13 },
    expiredBadge: { backgroundColor: '#FEE2E2', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
    expiredText: { color: '#EF4444', fontSize: 11, fontWeight: '600' },
    statsRow: { flexDirection: 'row', gap: 16, marginBottom: 16 },
    stat: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    statText: { fontSize: 13, fontWeight: '500' },
    actions: { flexDirection: 'row', borderTopWidth: 1, paddingTop: 16 },
    actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
    actionText: { fontSize: 14, fontWeight: '600' },
    divider: { width: 1, height: '100%' },
    empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 16 },
    emptyText: { fontSize: 18, fontWeight: '600' },
    emptySub: { fontSize: 14, textAlign: 'center' }
});
