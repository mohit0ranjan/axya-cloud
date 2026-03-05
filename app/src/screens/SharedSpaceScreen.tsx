import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import FileListComponent from '../components/FileListComponent';
import PasswordGateComponent from '../components/PasswordGateComponent';
import UploadFileButton from '../components/UploadFileButton';
import {
    fetchSharedSpace,
    fetchSharedSpaceFiles,
    SharedSpaceDto,
    SharedSpaceFileDto,
    SharedSpaceFolderDto,
    validateSharedSpacePassword,
} from '../services/sharedSpaceApi';

export default function SharedSpaceScreen({ route }: any) {
    const spaceId = String(route?.params?.spaceId || '');
    const { theme } = useTheme();

    const [space, setSpace] = useState<SharedSpaceDto | null>(null);
    const [files, setFiles] = useState<SharedSpaceFileDto[]>([]);
    const [folders, setFolders] = useState<SharedSpaceFolderDto[]>([]);
    const [folderPath, setFolderPath] = useState('/');
    const [accessToken, setAccessToken] = useState('');
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const hasLoadedRef = useRef(false);

    const load = useCallback(async (nextFolderPath: string, silent = false) => {
        if (!spaceId) return;
        if (!silent) setLoading(true);
        try {
            const [spaceMeta, filePayload] = await Promise.all([
                fetchSharedSpace(spaceId, accessToken || undefined),
                fetchSharedSpaceFiles(spaceId, nextFolderPath, accessToken || undefined),
            ]);
            setSpace(spaceMeta);
            setFiles(filePayload.files);
            setFolders(filePayload.folders);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [accessToken, spaceId]);

    useEffect(() => {
        if (hasLoadedRef.current) return;
        hasLoadedRef.current = true;
        void load('/');
    }, [load]);

    const onPasswordSubmit = useCallback(async (password: string) => {
        const token = await validateSharedSpacePassword(spaceId, password);
        setAccessToken(token);
        await load(folderPath, true);
    }, [folderPath, load, spaceId]);

    const onRefresh = useCallback(() => {
        setRefreshing(true);
        void load(folderPath, true);
    }, [folderPath, load]);

    const onOpenFolder = useCallback((path: string) => {
        setFolderPath(path);
        void load(path, true);
    }, [load]);

    const onDownload = useCallback(async (file: SharedSpaceFileDto) => {
        if (!file.download_url) return;
        const base = String((process.env.EXPO_PUBLIC_API_URL || '').replace(/\/$/, ''));
        const absolute = file.download_url.startsWith('http') ? file.download_url : `${base}${file.download_url}`;
        const ok = await Linking.canOpenURL(absolute);
        if (!ok) {
            Alert.alert('Error', 'Unable to open file download link.');
            return;
        }
        await Linking.openURL(absolute);
    }, []);

    const showPasswordGate = useMemo(() => {
        return Boolean(space?.requires_password && !space?.has_access && !accessToken);
    }, [accessToken, space?.has_access, space?.requires_password]);

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.content}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
            >
                <Text style={[styles.title, { color: theme.colors.textHeading }]}>{space?.name || 'Shared Space'}</Text>
                <Text style={[styles.path, { color: theme.colors.textBody }]}>{folderPath}</Text>

                {showPasswordGate ? (
                    <PasswordGateComponent onSubmit={onPasswordSubmit} />
                ) : (
                    <>
                        {space?.allow_upload && (
                            <View style={styles.uploadRow}>
                                <UploadFileButton
                                    spaceId={spaceId}
                                    folderPath={folderPath}
                                    accessToken={accessToken || undefined}
                                    onUploaded={() => void load(folderPath, true)}
                                />
                            </View>
                        )}
                        <FileListComponent
                            files={files}
                            folders={folders}
                            canDownload={Boolean(space?.allow_download)}
                            onOpenFolder={onOpenFolder}
                            onDownload={onDownload}
                        />
                    </>
                )}

                {loading && <Text style={[styles.loading, { color: theme.colors.textBody }]}>Loading...</Text>}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scroll: {
        flex: 1,
    },
    content: {
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 32,
        gap: 12,
    },
    title: {
        fontSize: 22,
        fontWeight: '700',
    },
    path: {
        fontSize: 12,
        fontWeight: '500',
    },
    uploadRow: {
        alignItems: 'flex-start',
    },
    loading: {
        textAlign: 'center',
        marginTop: 8,
        fontSize: 13,
    },
});
