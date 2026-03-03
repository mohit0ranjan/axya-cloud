import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { FileText, Image as ImageIcon, Film, Music, Archive, Folder, Star, Trash2 } from 'lucide-react-native';
import { Image } from 'expo-image';
import { theme } from '../ui/theme';

interface Props {
    item: any;
    onPress: () => void;
    onTrash?: () => void;
    onStar?: () => void;
    onRestore?: () => void;
    showRestore?: boolean;
    token?: string;
    apiBase?: string;
}

const ICON_MAP: Record<string, { icon: any; color: string; bg: string }> = {
    image: { icon: ImageIcon, color: '#F59E0B', bg: '#FEF3C7' },
    video: { icon: Film, color: '#9333EA', bg: '#F3E8FF' },
    audio: { icon: Music, color: '#1FD45A', bg: '#DCFCE7' },
    pdf: { icon: FileText, color: '#EF4444', bg: '#FEE2E2' },
    folder: { icon: Folder, color: theme.colors.primary, bg: '#EEF1FD' },
    zip: { icon: Archive, color: '#F97316', bg: '#FFEDD5' },
    default: { icon: FileText, color: theme.colors.primary, bg: '#EEF1FD' },
};

const getIconConfig = (item: any) => {
    if (item.result_type === 'folder' || item.mime_type === 'inode/directory') return ICON_MAP.folder;
    if (item.mime_type?.includes('image')) return ICON_MAP.image;
    if (item.mime_type?.includes('video')) return ICON_MAP.video;
    if (item.mime_type?.includes('audio')) return ICON_MAP.audio;
    if (item.mime_type?.includes('pdf')) return ICON_MAP.pdf;
    if (item.mime_type?.includes('zip') || item.mime_type?.includes('compress')) return ICON_MAP.zip;
    return ICON_MAP.default;
};

const formatSize = (bytes: number) => {
    if (!bytes) return '';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
};

const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = (now.getTime() - d.getTime()) / 1000;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export default function FileCard({ item, onPress, onTrash, onStar, onRestore, showRestore, token, apiBase }: Props) {
    const config = getIconConfig(item);
    const IconComp = config.icon;
    const isFolder = item.result_type === 'folder' || item.mime_type === 'inode/directory';
    const isMedia = (item.mime_type?.includes('image') || item.mime_type?.includes('video')) && !isFolder;
    const hasStreamUrl = !!token && !!apiBase && !isFolder;

    return (
        <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
            {/* Thumbnail / Icon */}
            <View style={[styles.iconBox, { backgroundColor: config.bg, overflow: 'hidden' }]}>
                {isMedia && hasStreamUrl ? (
                    <Image
                        source={{
                            uri: `${apiBase}/files/${item.id}/thumbnail`,
                            headers: { Authorization: `Bearer ${token}` },
                        }}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                        cachePolicy="disk"
                        transition={200}
                    />
                ) : (
                    <IconComp color={config.color} size={24} />
                )}
            </View>

            {/* Meta */}
            <View style={styles.info}>
                <Text style={styles.name} numberOfLines={1}>{item.name || item.file_name}</Text>
                <Text style={styles.meta}>
                    {isFolder
                        ? `Folder${item.file_count != null ? ` · ${item.file_count} items` : ''}`
                        : [formatSize(item.size), formatDate(item.created_at)].filter(Boolean).join('  ·  ')
                    }
                </Text>
            </View>

            {/* Actions */}
            <View style={styles.actions}>
                {onStar && !showRestore && (
                    <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={(e) => {
                            e.stopPropagation();
                            onStar();
                        }}
                    >
                        <Star
                            color={item.is_starred ? '#FCBD0B' : theme.colors.textBody}
                            size={20}
                            fill={item.is_starred ? '#FCBD0B' : 'transparent'}
                        />
                    </TouchableOpacity>
                )}
                {showRestore && onRestore && (
                    <TouchableOpacity
                        style={[styles.actionBtnRestore]}
                        onPress={(e) => {
                            e.stopPropagation();
                            onRestore();
                        }}
                    >
                        <Text style={styles.actionBtnRestoreText}>Restore</Text>
                    </TouchableOpacity>
                )}
                {onTrash && (
                    <TouchableOpacity
                        style={[styles.actionBtnTrash]}
                        onPress={(e) => {
                            e.stopPropagation();
                            onTrash();
                        }}
                    >
                        <Trash2 color={theme.colors.danger} size={20} />
                    </TouchableOpacity>
                )}
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    card: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
        padding: 14, borderRadius: 20, marginBottom: 10,
        shadowColor: '#8a95a5', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 3,
    },
    iconBox: { width: 46, height: 46, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
    info: { flex: 1, marginHorizontal: 14 },
    name: { fontSize: 15, fontWeight: '600', color: theme.colors.textHeading, marginBottom: 3 },
    meta: { fontSize: 12, color: theme.colors.textBody, fontWeight: '500' },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    actionBtn: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background },
    actionBtnRestore: { paddingHorizontal: 16, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(31,212,90,0.1)' },
    actionBtnRestoreText: { fontSize: 13, fontWeight: '700', color: '#1FD45A' },
    actionBtnTrash: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(239,68,68,0.08)' },
});
