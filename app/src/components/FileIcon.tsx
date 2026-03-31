import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Image } from './AppImage';
import { Folder, Image as ImageIcon, FileText, Film, Music, Archive } from 'lucide-react-native';
import { buildApiFileUrl } from '../utils/fileSafety';
import { useServerStatus } from '../context/ServerStatusContext';

const failedThumbnailIds = new Map<string, number>();
const THUMB_RETRY_AFTER_MS = 60_000; // retry failed thumbnails after 60s

const isThumbBlacklisted = (id: string): boolean => {
    const failedAt = failedThumbnailIds.get(id);
    if (!failedAt) return false;
    if (Date.now() - failedAt > THUMB_RETRY_AFTER_MS) {
        failedThumbnailIds.delete(id);
        return false;
    }
    return true;
};

export function getIconConfig(mime: string, themeColors: any) {
    if (!mime || mime === 'inode/directory') return { color: themeColors.primary, bg: 'transparent', Icon: Folder };
    if (mime.includes('image')) return { color: '#F59E0B', bg: '#FEF3C7', Icon: ImageIcon };
    if (mime.includes('video')) return { color: '#9333EA', bg: '#F3E8FF', Icon: Film };
    if (mime.includes('audio')) return { color: '#1FD45A', bg: '#DCFCE7', Icon: Music };
    if (mime.includes('pdf')) return { color: '#EF4444', bg: '#FEE2E2', Icon: FileText };
    if (mime.includes('zip') || mime.includes('compress')) return { color: '#F97316', bg: '#FFEDD5', Icon: Archive };
    return { color: '#8892A4', bg: '#F1F3F9', Icon: FileText };
}

export const FileIcon = ({ item = {}, size = 46, token, apiBase, themeColors = { primary: '#4B6EF5' }, style }: any) => {
    const { isWaking } = useServerStatus();
    const itemId = String(item?.id || '');
    const [imgError, setImgError] = useState(itemId ? isThumbBlacklisted(itemId) : false);

    const isFolder = item?.result_type === 'folder' || item?.mime_type === 'inode/directory';
    const mimeType = String(item?.mime_type || '').toLowerCase();
    const canPreviewThumb = mimeType.startsWith('image/') || mimeType.startsWith('video/') || mimeType === 'application/pdf';
    const canLoadThumb = canPreviewThumb && !isFolder && !!token && !!apiBase && !!itemId && !imgError && !isWaking;

    const { color, bg, Icon } = getIconConfig(item?.mime_type || '', themeColors);

    // Remove trailing slash from apiBase to avoid double slash
    const baseUrl = apiBase ? apiBase.replace(/\/$/, '') : '';

    return (
        <View style={[{ width: size, height: size, borderRadius: isFolder ? 0 : size * 0.28, justifyContent: 'center', alignItems: 'center', backgroundColor: bg, overflow: 'hidden' }, style]}>
            {canLoadThumb ? (
                <Image
                    source={{
                        uri: buildApiFileUrl(baseUrl, itemId, 'thumbnail'),
                        headers: { Authorization: `Bearer ${token}` },
                    }}
                    placeholder={item?.blurhash ? { blurhash: item.blurhash } : undefined}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                    cachePolicy="disk"
                    transition={200}
                    onError={() => {
                        if (itemId) failedThumbnailIds.set(itemId, Date.now());
                        setImgError(true);
                    }}
                />
            ) : (
                <Icon color={color} size={isFolder ? size * 0.9 : size * 0.5} fill={isFolder ? color : 'none'} />
            )}
        </View>
    );
};
