import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image as RNImage } from 'react-native';
import { Folder, Star, FileText, Image as ImageIcon, Film, Music, Archive, MoreHorizontal } from 'lucide-react-native';
import { lightTheme } from '../context/ThemeContext';
import { formatFolderMeta } from '../utils/folderMeta';

type Theme = typeof lightTheme;

export interface FileItem {
    id: string;
    name?: string;
    file_name?: string;
    mime_type?: string;
    size?: number;
    created_at?: string;
    is_starred?: boolean;
    result_type?: string;
    file_count?: number;
    total_file_count?: number;
    folder_count?: number;
}

interface FileListItemProps {
    item: FileItem;
    token: string | null;
    apiBaseUrl: string;
    theme: Theme;
    isDark: boolean;
    onPress: (item: FileItem, isFolder: boolean) => void;
    variant?: 'default' | 'card';
}

const getIconConfig = (mime: string, isDark: boolean) => {
    if (!mime) return { Icon: FileText, color: '#8892A4', bg: isDark ? 'rgba(136,146,164,0.15)' : '#F1F3F9' };
    if (mime.includes('image')) return { Icon: ImageIcon, color: '#F59E0B', bg: isDark ? 'rgba(245,158,11,0.15)' : '#FEF3C7' };
    if (mime.includes('video')) return { Icon: Film, color: '#9333EA', bg: isDark ? 'rgba(147,51,234,0.15)' : '#F3E8FF' };
    if (mime.includes('audio')) return { Icon: Music, color: '#1FD45A', bg: isDark ? 'rgba(31,212,90,0.15)' : '#DCFCE7' };
    if (mime.includes('pdf')) return { Icon: FileText, color: '#EF4444', bg: isDark ? 'rgba(239,68,68,0.15)' : '#FEE2E2' };
    if (mime.includes('zip') || mime.includes('compress')) return { Icon: Archive, color: '#F97316', bg: isDark ? 'rgba(249,115,22,0.15)' : '#FFEDD5' };
    return { Icon: FileText, color: '#8892A4', bg: isDark ? 'rgba(136,146,164,0.15)' : '#F1F3F9' };
};

const formatSize = (bytes?: number) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
};

const formatDate = (d?: string) => {
    if (!d) return '';
    const date = new Date(d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
};

const createStyles = (theme: Theme) => StyleSheet.create({
    fileRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 0,
    },
    fileRowCard: {
        borderRadius: 0,
        paddingHorizontal: 20,
        paddingVertical: 14,
        backgroundColor: theme.colors.card,
        borderBottomWidth: 0,
        shadowColor: 'transparent',
        elevation: 0,
    },
    fileIcon: {
        width: 42,
        height: 42,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 16,
    },
    fileIconCard: {
        width: 54,
        height: 54,
        marginRight: 16,
    },
    fileInfo: {
        flex: 1,
        justifyContent: 'center',
    },
    fileName: {
        fontSize: 16,
        fontWeight: '600',
        color: theme.colors.textHeading,
        marginBottom: 4,
    },
    fileMeta: {
        fontSize: 13,
        color: theme.colors.textBody,
        fontWeight: '500',
    },
});

const FileListItem = ({ item, token, apiBaseUrl, theme, isDark, onPress, variant = 'default' }: FileListItemProps) => {
    const styles = React.useMemo(() => createStyles(theme), [theme]);
    const C = {
        card: theme.colors.card,
        text: theme.colors.textHeading,
        muted: theme.colors.textBody,
        primary: theme.colors.primary,
        accent: theme.colors.accent,
        purple: isDark ? '#A855F7' : '#9B59B6',
        success: theme.colors.success,
        warning: '#F59E0B',
        danger: theme.colors.danger,
        orange: '#F97316',
        softPrimary: isDark ? 'rgba(88,117,255,0.18)' : '#EEF1FD',
        softWarning: isDark ? 'rgba(245,158,11,0.18)' : '#FEF3C7',
        softPurple: isDark ? 'rgba(168,85,247,0.18)' : '#F3E8FF',
        softSuccess: isDark ? 'rgba(16,185,129,0.18)' : '#DCFCE7',
        softDanger: isDark ? 'rgba(239,68,68,0.18)' : '#FEE2E2',
        softOrange: isDark ? 'rgba(249,115,22,0.18)' : '#FFEDD5',
    };

    const isFolder = item.mime_type === 'inode/directory' || item.result_type === 'folder';
    const cfg = isFolder
        ? { Icon: Folder, color: '#4B6EF5', bg: 'transparent' }
        : getIconConfig(item.mime_type || '', isDark);
    const { Icon, color, bg } = cfg;

    const handlePress = () => {
        onPress(item, isFolder);
    };

    return (
        <TouchableOpacity
            style={[styles.fileRow, variant === 'card' && styles.fileRowCard]}
            activeOpacity={0.7}
            onPress={handlePress}
        >
            <View style={[
                styles.fileIcon,
                { backgroundColor: bg, overflow: 'hidden' },
                !isFolder ? { borderRadius: 16 } : null,
                variant === 'card' && styles.fileIconCard,
                variant === 'card' && !isFolder ? { borderRadius: 16 } : null
            ]}>
                {!isFolder && (item.mime_type?.includes('image') || item.mime_type?.includes('video')) ? (
                    <RNImage
                        source={{
                            uri: `${apiBaseUrl}/files/${item.id}/thumbnail`,
                            headers: { Authorization: `Bearer ${token}` },
                        }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                        // fallback to just the background box if no thumbnail is generated yet
                        defaultSource={undefined}
                    />
                ) : (
                    <Icon color={color} size={isFolder ? 38 : (variant === 'card' ? 24 : 22)} fill={isFolder ? color : 'none'} />
                )}
            </View>
            <View style={styles.fileInfo}>
                <Text style={styles.fileName} numberOfLines={1}>
                    {item.name || item.file_name}
                </Text>
                <Text style={styles.fileMeta}>
                    {isFolder
                        ? formatFolderMeta(item)
                        : [formatSize(item.size), formatDate(item.created_at)].filter(Boolean).join(' • ')}
                </Text>
            </View>
            {item.is_starred && (
                <Star color={C.accent} size={14} fill={C.accent} style={{ marginRight: 8 }} />
            )}
            <MoreHorizontal color={theme.colors.border} size={20} />
        </TouchableOpacity>
    );
};

function arePropsEqual(prev: FileListItemProps, next: FileListItemProps): boolean {
    return (
        prev.item.id === next.item.id &&
        prev.item.is_starred === next.item.is_starred &&
        prev.item.name === next.item.name &&
        prev.item.file_name === next.item.file_name &&
        prev.item.size === next.item.size &&
        prev.item.mime_type === next.item.mime_type &&
        prev.item.file_count === next.item.file_count &&
        prev.item.total_file_count === next.item.total_file_count &&
        prev.item.folder_count === next.item.folder_count &&
        prev.theme === next.theme &&
        prev.isDark === next.isDark &&
        prev.token === next.token &&
        prev.variant === next.variant
    );
}

export default memo(FileListItem, arePropsEqual);
