import React, { memo, useRef, useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image as RNImage, Animated } from 'react-native';
import { Folder, Star, FileText, Image as ImageIcon, Film, Music, Archive, MoreHorizontal } from 'lucide-react-native';
import { lightTheme } from '../context/ThemeContext';
import { formatFolderMeta } from '../utils/folderMeta';
import { buildApiFileUrl, sanitizeDisplayName } from '../utils/fileSafety';

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
    onOptionsPress?: (item: FileItem) => void;
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
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 14,
        backgroundColor: theme.colors.card,
        borderBottomWidth: 0,
        shadowColor: 'transparent',
        elevation: 0,
    },
    fileIcon: {
        width: 44,
        height: 44,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 14,
    },
    fileIconCard: {
        width: 44,
        height: 44,
        marginRight: 14,
    },
    fileInfo: {
        flex: 1,
        justifyContent: 'center',
        marginRight: 8,
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

const FileListItem = ({ item, token, apiBaseUrl, theme, isDark, onPress, onOptionsPress, variant = 'default' }: FileListItemProps) => {
    const styles = React.useMemo(() => createStyles(theme), [theme]);

    // ── Fade-in animation ─────────────────────────────────────────────────
    const fadeAnim = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 250,
            useNativeDriver: true,
        }).start();
    }, []);

    // ── Press scale animation ─────────────────────────────────────────────
    const rowScale = useRef(new Animated.Value(1)).current;
    const handleRowPressIn = useCallback(() => {
        Animated.spring(rowScale, { toValue: 0.97, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
    }, []);
    const handleRowPressOut = useCallback(() => {
        Animated.spring(rowScale, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
    }, []);

    // ── Thumbnail error state ─────────────────────────────────────────────
    const [thumbFailed, setThumbFailed] = useState(false);
    const handleThumbError = useCallback(() => setThumbFailed(true), []);

    // ── Options button press animation ────────────────────────────────────
    const optionsScale = useRef(new Animated.Value(1)).current;
    const handleOptionsIn = useCallback(() => {
        Animated.spring(optionsScale, { toValue: 0.8, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
    }, []);
    const handleOptionsOut = useCallback(() => {
        Animated.spring(optionsScale, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start();
    }, []);

    const C = {
        accent: theme.colors.accent,
    };

    const isFolder = item.mime_type === 'inode/directory' || item.result_type === 'folder';
    const cfg = isFolder
        ? { Icon: Folder, color: '#4B6EF5', bg: 'transparent' }
        : getIconConfig(item.mime_type || '', isDark);
    const { Icon, color, bg } = cfg;

    const mimeType = String(item.mime_type || '').toLowerCase();
    const canShowThumb = !isFolder && !thumbFailed && (
        mimeType.startsWith('image/')
        || mimeType.startsWith('video/')
        || mimeType === 'application/pdf'
    );

    const handlePress = () => {
        onPress(item, isFolder);
    };

    return (
        <Animated.View style={{ opacity: fadeAnim, transform: [{ scale: rowScale }] }}>
            <TouchableOpacity
                style={[styles.fileRow, variant === 'card' && styles.fileRowCard]}
                activeOpacity={0.7}
                onPress={handlePress}
                onPressIn={handleRowPressIn}
                onPressOut={handleRowPressOut}
            >
                <View style={[
                    styles.fileIcon,
                    { backgroundColor: bg, overflow: 'hidden' },
                    !isFolder ? { borderRadius: 16 } : null,
                    variant === 'card' && styles.fileIconCard,
                    variant === 'card' && !isFolder ? { borderRadius: 16 } : null
                ]}>
                    {canShowThumb ? (
                        <RNImage
                            source={{
                                uri: buildApiFileUrl(apiBaseUrl, item.id, 'thumbnail'),
                                headers: { Authorization: `Bearer ${token}` },
                            }}
                            style={{ width: '100%', height: '100%' }}
                            resizeMode="cover"
                            onError={handleThumbError}
                        />
                    ) : (
                        <Icon color={color} size={isFolder ? 40 : 24} fill={isFolder ? color : 'none'} />
                    )}
                </View>
                <View style={styles.fileInfo}>
                    <Text style={styles.fileName} numberOfLines={1}>
                        {sanitizeDisplayName(item.name || item.file_name || '', 'File')}
                    </Text>
                    <Text style={styles.fileMeta} numberOfLines={1}>
                        {isFolder
                            ? formatFolderMeta(item)
                            : [formatSize(item.size), formatDate(item.created_at)].filter(Boolean).join(' • ')}
                    </Text>
                </View>
                {item.is_starred && (
                    <Star color={C.accent} size={14} fill={C.accent} style={{ marginRight: 8 }} />
                )}
                <Animated.View style={{ transform: [{ scale: optionsScale }] }}>
                    <TouchableOpacity
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        onPress={() => onOptionsPress && onOptionsPress(item)}
                        onPressIn={handleOptionsIn}
                        onPressOut={handleOptionsOut}
                    >
                        <MoreHorizontal color={theme.colors.border} size={20} />
                    </TouchableOpacity>
                </Animated.View>
            </TouchableOpacity>
        </Animated.View>
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
