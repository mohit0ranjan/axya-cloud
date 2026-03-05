import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, Modal, TouchableOpacity, TextInput,
    KeyboardAvoidingView, Platform, Switch, ActivityIndicator, Alert
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { X, Copy, Link as LinkIcon, ShieldAlert } from 'lucide-react-native';
import { theme as staticTheme } from '../ui/theme';
import { useTheme } from '../context/ThemeContext';
import { createShareLink } from '../services/api';
import apiClient from '../services/apiClient';

interface ShareFolderModalProps {
    visible: boolean;
    onClose: () => void;
    targetItem: any; // Could be a file or a folder
}

export default function ShareFolderModal({ visible, onClose, targetItem }: ShareFolderModalProps) {
    const { theme } = useTheme();

    const [isLoading, setIsLoading] = useState(false);
    const [generatedLink, setGeneratedLink] = useState('');

    // Settings
    const [allowDownload, setAllowDownload] = useState(true);
    const [viewOnly, setViewOnly] = useState(false);
    const [password, setPassword] = useState('');
    const [expiryHours, setExpiryHours] = useState<number | null>(null);

    // Reset state when modal opens
    useEffect(() => {
        if (visible) {
            setGeneratedLink('');
            setPassword('');
            setAllowDownload(true);
            setViewOnly(false);
            setExpiryHours(null);
        }
    }, [visible, targetItem]);

    const handleGenerate = async () => {
        if (!targetItem) return;
        setIsLoading(true);
        try {
            const isFolder = targetItem.type === 'folder' || targetItem.result_type === 'folder' || targetItem.mime_type === 'inode/directory';

            const options = {
                file_id: !isFolder ? targetItem.id : undefined,
                folder_id: isFolder ? targetItem.id : undefined,
                password: password.trim() || undefined,
                expires_in_hours: expiryHours || undefined,
                allow_download: allowDownload,
                view_only: viewOnly
            };

            const res = await createShareLink(options);
            if (res.success && res.token) {
                // Construct the full public URL
                const baseUrl = apiClient.defaults.baseURL?.replace('/api', '') || 'https://axya.cloud';
                setGeneratedLink(`${baseUrl}/share/${res.token}`);
            } else {
                Alert.alert('Error', 'Failed to generate link.');
            }
        } catch (err: any) {
            Alert.alert('Error', err.response?.data?.error || 'Failed to create share link.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopy = async () => {
        if (generatedLink) {
            await Clipboard.setStringAsync(generatedLink);
            Alert.alert('Copied!', 'Link copied to clipboard.');
        }
    };

    if (!targetItem) return null;

    return (
        <Modal visible={visible} transparent animationType="slide">
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={styles.overlay}
            >
                <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

                <View style={[styles.sheet, { backgroundColor: theme.colors.card }]}>
                    <View style={styles.dragHandle} />

                    <View style={styles.header}>
                        <Text style={[styles.title, { color: theme.colors.textHeading }]}>
                            Share {targetItem.name || targetItem.file_name}
                        </Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                            <X color={theme.colors.textBody} size={24} />
                        </TouchableOpacity>
                    </View>

                    <Text style={styles.description}>
                        Create a secure, public link to share this {targetItem.type === 'folder' || targetItem.result_type === 'folder' || targetItem.mime_type === 'inode/directory' ? 'folder' : 'file'}.
                    </Text>

                    {generatedLink ? (
                        <View style={styles.resultContainer}>
                            <View style={[styles.linkBox, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
                                <LinkIcon color={theme.colors.primary} size={20} />
                                <Text style={[styles.linkText, { color: theme.colors.textHeading }]} numberOfLines={1}>
                                    {generatedLink}
                                </Text>
                                <TouchableOpacity onPress={handleCopy} style={styles.copyBtn}>
                                    <Copy color="#fff" size={16} />
                                </TouchableOpacity>
                            </View>
                            <TouchableOpacity style={[styles.btn, { backgroundColor: theme.colors.border }]} onPress={onClose}>
                                <Text style={[styles.btnText, { color: theme.colors.textHeading }]}>Done</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <View style={styles.settingsContainer}>
                            <View style={styles.settingRow}>
                                <View style={styles.settingText}>
                                    <Text style={[styles.settingTitle, { color: theme.colors.textHeading }]}>Allow Downloads</Text>
                                    <Text style={styles.settingSub}>Visitors can download contents</Text>
                                </View>
                                <Switch
                                    value={allowDownload}
                                    onValueChange={setAllowDownload}
                                    trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                                    thumbColor="#fff"
                                />
                            </View>

                            <View style={styles.settingRow}>
                                <View style={styles.settingText}>
                                    <Text style={[styles.settingTitle, { color: theme.colors.textHeading }]}>Password Protect</Text>
                                    <Text style={styles.settingSub}>Require a password to view</Text>
                                </View>
                            </View>
                            <TextInput
                                style={[styles.input, { backgroundColor: theme.colors.background, borderColor: theme.colors.border, color: theme.colors.textHeading }]}
                                placeholder="Enter password (optional)"
                                placeholderTextColor={theme.colors.textBody}
                                value={password}
                                onChangeText={setPassword}
                                secureTextEntry
                            />

                            <View style={[styles.settingRow, { marginTop: 16 }]}>
                                <View style={styles.settingText}>
                                    <Text style={[styles.settingTitle, { color: theme.colors.textHeading }]}>Link Expiry</Text>
                                    <Text style={styles.settingSub}>Automatically revoke access</Text>
                                </View>
                            </View>
                            <View style={styles.pillContainer}>
                                {[
                                    { label: 'Never', value: null },
                                    { label: '24h', value: 24 },
                                    { label: '7 Days', value: 168 },
                                    { label: '30 Days', value: 720 },
                                ].map(opt => (
                                    <TouchableOpacity
                                        key={opt.label}
                                        style={[
                                            styles.pill,
                                            { backgroundColor: theme.colors.background, borderColor: theme.colors.border },
                                            expiryHours === opt.value && { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }
                                        ]}
                                        onPress={() => setExpiryHours(opt.value)}
                                    >
                                        <Text style={[
                                            styles.pillText,
                                            { color: theme.colors.textBody },
                                            expiryHours === opt.value && { color: '#fff', fontWeight: '600' }
                                        ]}>
                                            {opt.label}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            <TouchableOpacity
                                style={[styles.btn, { backgroundColor: theme.colors.primary, marginTop: 32 }]}
                                onPress={handleGenerate}
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <ActivityIndicator color="#fff" />
                                ) : (
                                    <Text style={[styles.btnText, { color: '#fff' }]}>Generate Link</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    backdrop: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    sheet: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: 24,
        paddingBottom: Platform.OS === 'ios' ? 40 : 24,
        ...staticTheme.shadows.card,
    },
    dragHandle: {
        width: 40,
        height: 4,
        backgroundColor: '#E2E8F0',
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    title: {
        fontSize: 20,
        fontWeight: '700',
    },
    closeBtn: {
        padding: 4,
    },
    description: {
        fontSize: 14,
        color: '#6B7A99',
        marginBottom: 24,
    },
    settingsContainer: {
        gap: 12,
    },
    settingRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    settingText: {
        flex: 1,
    },
    settingTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 2,
    },
    settingSub: {
        fontSize: 13,
        color: '#6B7A99',
    },
    input: {
        height: 48,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 16,
        fontSize: 15,
        marginTop: 8,
    },
    pillContainer: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 8,
    },
    pill: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 20,
        borderWidth: 1,
    },
    pillText: {
        fontSize: 14,
    },
    btn: {
        height: 52,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
    },
    btnText: {
        fontSize: 16,
        fontWeight: '700',
    },
    resultContainer: {
        gap: 16,
    },
    linkBox: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        gap: 12,
    },
    linkText: {
        flex: 1,
        fontSize: 15,
        fontWeight: '500',
    },
    copyBtn: {
        backgroundColor: staticTheme.colors.primary,
        padding: 10,
        borderRadius: 10,
    }
});
