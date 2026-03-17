import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, Modal, TouchableOpacity,
    KeyboardAvoidingView, Platform, Switch, ActivityIndicator, TextInput, Keyboard, Share
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { X, Copy, Link as LinkIcon, Share2 } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { createShareLink } from '../services/api';
import { resolveShareUrl } from '../utils/shareUrls';

interface ShareFolderModalProps {
    visible: boolean;
    onClose: () => void;
    targetItem: any; // Could be a file or a folder
}

const isFolderTarget = (target: any): boolean => {
    if (!target) return false;
    const mime = String(target.mime_type || '').toLowerCase();
    const type = String(target.type || target.result_type || '').toLowerCase();
    if (target.is_folder === true) return true;
    if (type === 'folder') return true;
    if (mime === 'inode/directory') return true;
    if (target.folder_id && !target.file_id) return true;
    return false;
};

const resolveTargetId = (target: any): string => {
    if (!target) return '';
    return String(target.id || target.folder_id || target.file_id || '').trim();
};

export default function ShareFolderModal({ visible, onClose, targetItem }: ShareFolderModalProps) {
    const { theme } = useTheme();
    const { showToast } = useToast();
    const [activeTarget, setActiveTarget] = useState<any>(null);

    const [isLoading, setIsLoading] = useState(false);
    const [generatedLink, setGeneratedLink] = useState('');

    // Settings
    const [allowDownload, setAllowDownload] = useState(true);
    const [expiryHours, setExpiryHours] = useState<number | null>(null);
    const [enablePassword, setEnablePassword] = useState(false);
    const [password, setPassword] = useState('');
    const wasVisibleRef = useRef(false);

    // Reset and snapshot target only on visibility transitions to avoid churn/flicker.
    useEffect(() => {
        const justOpened = visible && !wasVisibleRef.current;
        const justClosed = !visible && wasVisibleRef.current;
        wasVisibleRef.current = visible;

        if (justOpened) {
            setActiveTarget(targetItem || null);
            setIsLoading(false);
            setGeneratedLink('');
            setAllowDownload(true);
            setExpiryHours(null);
            setEnablePassword(false);
            setPassword('');
            return;
        }

        // In case the modal opens before target arrives, hydrate once without resetting state.
        if (visible && !activeTarget && targetItem) {
            setActiveTarget(targetItem);
            return;
        }

        if (justClosed) {
            const t = setTimeout(() => setActiveTarget(null), 220);
            return () => clearTimeout(t);
        }
    }, [visible, targetItem, activeTarget]);

    const handleGenerate = async () => {
        if (!activeTarget) return;
        Keyboard.dismiss();
        setIsLoading(true);
        try {
            const isFolder = isFolderTarget(activeTarget);
            const targetId = resolveTargetId(activeTarget);
            if (!targetId) {
                showToast('Invalid item selected for sharing.', 'error');
                return;
            }

            const options = {
                file_id: !isFolder ? targetId : undefined,
                folder_id: isFolder ? targetId : undefined,
                expires_in_hours: expiryHours || undefined,
                allow_download: allowDownload,
                password: enablePassword ? password.trim() : '',
            };

            const res = await createShareLink(options);
            const resolvedLink = resolveShareUrl(res);
            if (res.success && resolvedLink) {
                setGeneratedLink(resolvedLink);
                showToast('Share link generated', 'success');
            } else {
                showToast(res?.error || res?.message || 'Failed to generate link.', 'error');
            }
        } catch (err: any) {
            const status = Number(err?.response?.status || 0);
            const apiMsg = String(err?.response?.data?.message || err?.response?.data?.error || '').trim();
            const msg = apiMsg
                || (status === 401 ? 'Session expired. Please log in again.' : '')
                || (status === 404 ? 'Share API not found. Confirm backend exposes /api/v2/shares.' : '')
                || (status >= 500 ? 'Server error while creating share link. Please retry.' : '')
                || (err?.code === 'ECONNABORTED' ? 'Request timed out. Server may be waking up, retry in a few seconds.' : '')
                || (!err?.response ? 'Cannot reach server. Check API URL/server status and retry.' : '')
                || err?.message
                || 'Failed to create share link.';
            showToast(msg, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopy = async () => {
        if (generatedLink) {
            await Clipboard.setStringAsync(generatedLink);
            showToast('Link copied to clipboard', 'success');
        }
    };

    const handleNativeShare = async () => {
        if (!generatedLink) return;
        try {
            await Share.share({ message: generatedLink, url: generatedLink });
        } catch {
            showToast('System share is unavailable on this device.', 'error');
        }
    };

    const modalVisible = visible && !!activeTarget;
    if (!activeTarget && !modalVisible) return null;

    return (
        <Modal
            visible={modalVisible}
            transparent
            animationType="slide"
            onRequestClose={onClose}
            statusBarTranslucent
            presentationStyle="overFullScreen"
        >
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                style={styles.overlay}
            >
                <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />

                <View style={[styles.sheet, { backgroundColor: theme.colors.card }, theme.shadows.card]}>
                    <View style={styles.dragHandle} />

                    <View style={styles.header}>
                        <Text style={[styles.title, { color: theme.colors.textHeading }]}>
                            Share {activeTarget.name || activeTarget.file_name}
                        </Text>
                        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                            <X color={theme.colors.textBody} size={24} />
                        </TouchableOpacity>
                    </View>

                    <Text style={[styles.description, { color: theme.colors.textBody }]}>
                        Create a secure public link to share this {activeTarget.type === 'folder' || activeTarget.result_type === 'folder' || activeTarget.mime_type === 'inode/directory' ? 'folder' : 'file'}.
                    </Text>

                    {generatedLink ? (
                        <View style={styles.resultContainer}>
                            <View style={[styles.linkBox, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]}>
                                <LinkIcon color={theme.colors.primary} size={20} />
                                <Text style={[styles.linkText, { color: theme.colors.textHeading }]} numberOfLines={2}>
                                    {generatedLink}
                                </Text>
                                <TouchableOpacity onPress={handleCopy} style={[styles.copyBtn, { backgroundColor: theme.colors.primary }]}>
                                    <Copy color="#fff" size={16} />
                                </TouchableOpacity>
                            </View>
                            <View style={styles.resultActions}>
                                <TouchableOpacity style={[styles.secondaryBtn, { backgroundColor: theme.colors.background, borderColor: theme.colors.border }]} onPress={handleNativeShare}>
                                    <Share2 color={theme.colors.primary} size={16} />
                                    <Text style={[styles.secondaryBtnText, { color: theme.colors.textHeading }]}>Share</Text>
                                </TouchableOpacity>
                                <TouchableOpacity style={[styles.btn, { backgroundColor: theme.colors.border }]} onPress={onClose}>
                                    <Text style={[styles.btnText, { color: theme.colors.textHeading }]}>Done</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ) : (
                        <View style={styles.settingsContainer}>
                            <View style={styles.settingRow}>
                                <View style={styles.settingText}>
                                    <Text style={[styles.settingTitle, { color: theme.colors.textHeading }]}>Allow Downloads</Text>
                                    <Text style={[styles.settingSub, { color: theme.colors.textBody }]}>Visitors can download contents</Text>
                                </View>
                                <Switch
                                    value={allowDownload}
                                    onValueChange={setAllowDownload}
                                    trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                                    thumbColor="#fff"
                                />
                            </View>

                            <View style={[styles.settingRow, { marginTop: 16 }]}>
                                <View style={styles.settingText}>
                                    <Text style={[styles.settingTitle, { color: theme.colors.textHeading }]}>Link Expiry</Text>
                                    <Text style={[styles.settingSub, { color: theme.colors.textBody }]}>Automatically revoke access</Text>
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

                            <View style={[styles.settingRow, { marginTop: 16 }]}>
                                <View style={styles.settingText}>
                                    <Text style={[styles.settingTitle, { color: theme.colors.textHeading }]}>Password Protect</Text>
                                    <Text style={[styles.settingSub, { color: theme.colors.textBody }]}>Require password before opening link</Text>
                                </View>
                                <Switch
                                    value={enablePassword}
                                    onValueChange={(v) => {
                                        setEnablePassword(v);
                                        if (!v) setPassword('');
                                    }}
                                    trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                                    thumbColor="#fff"
                                />
                            </View>

                            {enablePassword && (
                                <View>
                                    <TextInput
                                        style={[
                                            styles.passwordInput,
                                            {
                                                borderColor: theme.colors.border,
                                                backgroundColor: theme.colors.background,
                                                color: theme.colors.textHeading,
                                            },
                                        ]}
                                        value={password}
                                        onChangeText={setPassword}
                                        placeholder="Set share password"
                                        placeholderTextColor={theme.colors.textBody}
                                        secureTextEntry
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                    />
                                    <Text style={[styles.passwordHint, { color: theme.colors.textBody }]}>Use at least 4 characters.</Text>
                                </View>
                            )}

                            <TouchableOpacity
                                style={[styles.btn, { backgroundColor: theme.colors.primary, marginTop: 32 }]}
                                onPress={handleGenerate}
                                disabled={isLoading || (enablePassword && password.trim().length < 4)}
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
    passwordInput: {
        marginTop: 8,
        height: 48,
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 14,
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
    resultActions: {
        flexDirection: 'row',
        gap: 12,
    },
    secondaryBtn: {
        flex: 1,
        height: 52,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'row',
        gap: 8,
        borderWidth: 1,
    },
    secondaryBtnText: {
        fontSize: 15,
        fontWeight: '600',
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
        fontSize: 14,
        fontWeight: '500',
    },
    copyBtn: {
        padding: 10,
        borderRadius: 10,
    },
    passwordHint: {
        fontSize: 12,
        marginTop: 8,
    },
});
