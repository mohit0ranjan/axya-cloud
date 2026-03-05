import React, { memo, useMemo } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Download, Folder } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { SharedSpaceFileDto, SharedSpaceFolderDto } from '../services/sharedSpaceApi';

type RowItem =
    | { kind: 'folder'; data: SharedSpaceFolderDto }
    | { kind: 'file'; data: SharedSpaceFileDto };

interface Props {
    files: SharedSpaceFileDto[];
    folders: SharedSpaceFolderDto[];
    canDownload: boolean;
    onOpenFolder: (folderPath: string) => void;
    onDownload: (file: SharedSpaceFileDto) => void;
}

const FileListComponent = ({ files, folders, canDownload, onOpenFolder, onDownload }: Props) => {
    const { theme } = useTheme();
    const rows = useMemo<RowItem[]>(
        () => [
            ...folders.map((f) => ({ kind: 'folder' as const, data: f })),
            ...files.map((f) => ({ kind: 'file' as const, data: f })),
        ],
        [files, folders]
    );

    return (
        <FlatList
            data={rows}
            keyExtractor={(item) => (item.kind === 'folder' ? `d_${item.data.path}` : `f_${item.data.id}`)}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
                item.kind === 'folder' ? (
                    <TouchableOpacity
                        style={[styles.row, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}
                        onPress={() => onOpenFolder(item.data.path)}
                    >
                        <Folder color={theme.colors.primary} size={18} />
                        <Text style={[styles.name, { color: theme.colors.textHeading }]} numberOfLines={1}>{item.data.name}</Text>
                    </TouchableOpacity>
                ) : (
                    <View style={[styles.row, { backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}>
                        <Text style={[styles.name, { color: theme.colors.textHeading }]} numberOfLines={1}>{item.data.file_name}</Text>
                        {canDownload && (
                            <TouchableOpacity onPress={() => onDownload(item.data)} style={styles.iconButton}>
                                <Download color={theme.colors.primary} size={18} />
                            </TouchableOpacity>
                        )}
                    </View>
                )
            )}
            ListEmptyComponent={<Text style={[styles.empty, { color: theme.colors.textBody }]}>No files yet</Text>}
        />
    );
};

export default memo(FileListComponent);

const styles = StyleSheet.create({
    list: {
        paddingBottom: 40,
        gap: 8,
    },
    row: {
        borderWidth: 1,
        borderRadius: 12,
        minHeight: 46,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    name: {
        flex: 1,
        fontSize: 14,
        fontWeight: '600',
    },
    iconButton: {
        padding: 6,
    },
    empty: {
        textAlign: 'center',
        marginTop: 24,
        fontSize: 13,
    },
});
