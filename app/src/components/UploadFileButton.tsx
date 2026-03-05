import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useTheme } from '../context/ThemeContext';
import { uploadSharedSpaceFile } from '../services/sharedSpaceApi';

interface Props {
    spaceId: string;
    folderPath: string;
    accessToken?: string;
    onUploaded: () => void;
}

export default function UploadFileButton({ spaceId, folderPath, accessToken, onUploaded }: Props) {
    const { theme } = useTheme();
    const [uploading, setUploading] = useState(false);

    const pickAndUpload = useCallback(async () => {
        if (uploading) return;
        const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: false });
        if (picked.canceled || !picked.assets?.[0]) return;
        const asset = picked.assets[0];

        setUploading(true);
        try {
            await uploadSharedSpaceFile(
                spaceId,
                { uri: asset.uri, name: asset.name, mimeType: asset.mimeType },
                folderPath,
                accessToken
            );
            onUploaded();
        } finally {
            setUploading(false);
        }
    }, [accessToken, folderPath, onUploaded, spaceId, uploading]);

    return (
        <TouchableOpacity
            style={[styles.button, { backgroundColor: theme.colors.primary }]}
            onPress={() => void pickAndUpload()}
            disabled={uploading}
        >
            {uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.text}>Upload</Text>}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    button: {
        minWidth: 96,
        height: 40,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    text: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 14,
    },
});
