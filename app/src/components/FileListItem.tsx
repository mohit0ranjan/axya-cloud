import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image as RNImage } from 'react-native';
import { Folder, Star, FileText, Image as ImageIcon, Film, Music, Archive, LucideIcon } from 'lucide-react-native';
import { lightTheme } from '../context/ThemeContext';

type Theme = typeof lightTheme;

// ── Types ──────────────────────────────────────────────────────────────────────
export interface FileItem {
    id: string;
    name?: string;
    file_name?: string;
    mime_type?: string;
    size?: number;
    created_at?: string;
    is_starred?: boolean;
    result_type?: string;
    // Folder metadata fields
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

// ── Helper: file icon config ──────────────────────────────────────────────────
const getIconConfig = (mime: string, primary: string, purple: string, success: string) => {
    // Helper to get icon config based on mime type
    
    if (!mime) return { Icon: FileText, color: primary, bg: '#EEF1FD' };
    if (mime.includes('image')) return { Icon: ImageIcon, color: '#F59E0B', bg: '#FEF3C7' };
    if (mime.includes('video')) return { Icon: Film, color: purple, bg: '#F3E8FF' };
    if (mime.includes('audio')) return { Icon: Music, color: success, bg: '#DCFCE7' };
    if (mime.includes('pdf')) return { Icon: FileText, color: '#EF4444', bg: '#FEE2E2' };
    if (mime.includes('zip') || mime.includes('compress')) return { Icon: Archive, color: '#F97316', bg: '#FFEDD5' };
    return { Icon: FileText, color: primary, bg: '#EEF1FD' };
};

// ── Helper: format size ───────────────────────────────────────────────────────
const formatSize = (bytes?: number) => {
    if (!bytes) return '0 B';
    const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
};

// ── Helper: format folder info ───────────────────────────────────────────────
const formatFolderInfo = (item: FileItem) => {
    const totalFiles = item.total_file_count ?? item.file_count ?? 0;
    const subfolders = item.folder_count ?? 0;
    
    if (subfolders > 0 && totalFiles > 0) {
        return `${totalFiles} files · ${subfolders} subfolders`;
    } else if (subfolders > 0) {
        return `${subfolders} subfolder${subfolders > 1 ? 's' : ''}`;
    } else if (totalFiles > 0) {
        return `${totalFiles} file${totalFiles > 1 ? 's' : ''}`;
    }
    return 'Empty folder';
};

// ── Helper: format date ───────────────────────────────────────────────────────
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

// ── Styles ────────────────────────────────────────────────────────────────────
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

// ── Component ──────────────────────────────────────────────────────────────────
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
    };

    const isFolder = item.mime_type === 'inode/directory' || item.result_type === 'folder';
    const cfg = isFolder
        ? { Icon: Folder, color: C.primary, bg: '#EEF1FD' }
        : getIconConfig(item.mime_type || '', C.primary, C.purple, C.success);
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
                    {isFolder ? formatFolderInfo(item) : [
                        formatSize(item.size),
                        formatDate(item.created_at),
                    ].filter(Boolean).join(' · ')}
                </Text>
            </View>
            {item.is_starred && (
                <Star color={C.accent} size={14} fill={C.accent} />
            )}
        </TouchableOpacity>
    );
};

// ── Custom comparison for React.memo ───────────────────────────────────────────
// Only re-render if item data actually changed
function arePropsEqual(prev: FileListItemProps, next: FileListItemProps): boolean {
    return (
        prev.item.id === next.item.id &&
        prev.item.is_starred === next.item.is_starred &&
        prev.item.name === next.item.name &&
        prev.item.file_name === next.item.file_name &&
        prev.item.size === next.item.size &&
        prev.item.mime_type === next.item.mime_type &&
        prev.theme === next.theme &&
        prev.isDark === next.isDark &&
        prev.token === next.token
    );
}

export default memo(FileListItem, arePropsEqual);
