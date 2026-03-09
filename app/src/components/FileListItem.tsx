import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image as RNImage } from 'react-native';
import { Folder, Star, FileText, Image as ImageIcon, Film, Music, Archive } from 'lucide-react-native';
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
}

const getIconConfig = (mime: string, C: {
    primary: string;
    warning: string;
    purple: string;
    success: string;
    danger: string;
    orange: string;
    softPrimary: string;
    softWarning: string;
    softPurple: string;
    softSuccess: string;
    softDanger: string;
    softOrange: string;
}) => {
    if (!mime) return { Icon: FileText, color: C.primary, bg: C.softPrimary };
    if (mime.includes('image')) return { Icon: ImageIcon, color: C.warning, bg: C.softWarning };
    if (mime.includes('video')) return { Icon: Film, color: C.purple, bg: C.softPurple };
    if (mime.includes('audio')) return { Icon: Music, color: C.success, bg: C.softSuccess };
    if (mime.includes('pdf')) return { Icon: FileText, color: C.danger, bg: C.softDanger };
    if (mime.includes('zip') || mime.includes('compress')) return { Icon: Archive, color: C.orange, bg: C.softOrange };
    return { Icon: FileText, color: C.primary, bg: C.softPrimary };
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
    const now = new Date();
    const diff = (now.getTime() - date.getTime()) / 1000;
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const createStyles = (theme: Theme) => StyleSheet.create({
    fileRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderRadius: 14,
        marginBottom: 8,
    },
    fileIcon: {
        width: 44,
        height: 44,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fileInfo: {
        flex: 1,
        marginLeft: 12,
    },
    fileName: {
        fontSize: 15,
        fontWeight: '500',
    },
    fileMeta: {
        fontSize: 12,
        marginTop: 3,
    },
});

const FileListItem = ({ item, token, apiBaseUrl, theme, isDark, onPress }: FileListItemProps) => {
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
        ? { Icon: Folder, color: C.primary, bg: C.softPrimary }
        : getIconConfig(item.mime_type || '', C);
    const { Icon, color, bg } = cfg;

    const handlePress = () => {
        onPress(item, isFolder);
    };

    return (
        <TouchableOpacity
            style={[styles.fileRow, { backgroundColor: C.card }]}
            activeOpacity={0.7}
            onPress={handlePress}
        >
            <View style={[styles.fileIcon, { backgroundColor: bg, overflow: 'hidden' }]}>
                {!isFolder && (item.mime_type?.includes('image') || item.mime_type?.includes('video')) ? (
                    <RNImage
                        source={{
                            uri: `${apiBaseUrl}/files/${item.id}/thumbnail`,
                            headers: { Authorization: `Bearer ${token}` },
                        }}
                        style={{ width: '100%', height: '100%' }}
                        resizeMode="cover"
                    />
                ) : (
                    <Icon color={color} size={22} />
                )}
            </View>
            <View style={styles.fileInfo}>
                <Text style={[styles.fileName, { color: C.text }]} numberOfLines={1}>
                    {item.name || item.file_name}
                </Text>
                <Text style={[styles.fileMeta, { color: C.muted }]}>
                    {isFolder
                        ? formatFolderMeta(item)
                        : [formatSize(item.size), formatDate(item.created_at)].filter(Boolean).join(' · ')}
                </Text>
            </View>
            {item.is_starred && (
                <Star color={C.accent} size={14} fill={C.accent} />
            )}
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
        prev.token === next.token
    );
}

export default memo(FileListItem, arePropsEqual);

