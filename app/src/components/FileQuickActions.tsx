import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal, View, Text, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, StyleSheet, Animated } from 'react-native';
import { Share2, Tag, Star, Move, Trash2, Folder } from 'lucide-react-native';
import apiClient from '../services/apiClient';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import { showDestructiveConfirm } from '../utils/alert';
import AppButton from './AppButton';
import ShareFolderModal from './ShareFolderModal';
import { syncAfterFileMutation } from '../services/fileStateSync';
import { emitFileDeleted, emitFileUpdated } from '../utils/events';
import { sanitizeDisplayName, sanitizeFileName } from '../utils/fileSafety';

// Animated action row with scale press feedback
const ActionRow = ({ style, onPress, children }: { style: any; onPress: () => void; children: React.ReactNode }) => {
    const scale = useRef(new Animated.Value(1)).current;
    const onIn = useCallback(() => { Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 50, bounciness: 4 }).start(); }, []);
    const onOut = useCallback(() => { Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50, bounciness: 4 }).start(); }, []);
    return (
        <Animated.View style={{ transform: [{ scale }] }}>
            <TouchableOpacity style={style} onPress={onPress} onPressIn={onIn} onPressOut={onOut} activeOpacity={0.8}>
                {children}
            </TouchableOpacity>
        </Animated.View>
    );
};

export default function FileQuickActions({ item, visible, onClose, onRefresh }: any) {
    const { theme, isDark } = useTheme();
    const { showToast } = useToast();
    const s = createStyles(theme, isDark);

    const [isRenameVisible, setRenameVisible] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [isRenaming, setIsRenaming] = useState(false);

    const [isMoveVisible, setMoveVisible] = useState(false);
    const [allFolders, setAllFolders] = useState<any[]>([]);

    const [isShareVisible, setShareVisible] = useState(false);

    useEffect(() => {
        if (!visible) {
            setRenameVisible(false);
            setMoveVisible(false);
            setShareVisible(false);
        }
    }, [visible]);

    if (!item) return null;

    const isFolder = item.mime_type === 'inode/directory' || item.result_type === 'folder';

    const handleRename = async () => {
        const nextName = sanitizeFileName(renameValue, 'file');
        if (!nextName || isRenaming) return;
        setIsRenaming(true);
        try {
            const endpoint = isFolder ? `/files/folder/${item.id}` : `/files/${item.id}`;
            await apiClient.patch(endpoint, { name: nextName, file_name: nextName });
            emitFileUpdated(item.id, { name: nextName, file_name: nextName });
            syncAfterFileMutation();
            showToast('Renamed successfully');
            setRenameVisible(false);
            onClose();
            onRefresh?.();
        } catch (e: any) {
            showToast(e.response?.data?.error || 'Could not rename', 'error');
        } finally {
            setIsRenaming(false);
        }
    };

    const handleDelete = async () => {
        const name = sanitizeDisplayName(item.name || item.file_name || 'this item', 'this item');
        const confirmed = await showDestructiveConfirm(
            isFolder ? 'Move Folder to Trash' : 'Move to Trash',
            isFolder ? `Move "${name}" and all its contents to trash?` : `Move "${name}" to trash?`,
            'Move to Trash'
        );
        if (!confirmed) return;
        
        try {
            if (isFolder) {
                await apiClient.delete(`/files/folder/${item.id}`);
            } else {
                await apiClient.patch(`/files/${item.id}/trash`);
            }
            emitFileDeleted(item.id);
            syncAfterFileMutation();
            showToast('Moved to trash');
            onClose();
            onRefresh?.();
        } catch (e: any) {
            showToast(e.response?.data?.error || 'Could not delete', 'error');
        }
    };

    const handleStar = async () => {
        try {
            await apiClient.patch(`/files/${item.id}/star`);
            emitFileUpdated(item.id, { is_starred: !item.is_starred });
            syncAfterFileMutation();
            showToast(item.is_starred ? 'Removed from favorites' : 'Added to favorites');
            onClose();
            onRefresh?.();
        } catch {
            showToast('Could not update status', 'error');
        }
    };

    const handleMoveInit = async () => {
        setMoveVisible(true);
        try {
            const res = await apiClient.get('/files/folders');
            if (res.data.success) {
                setAllFolders(res.data.folders);
            }
        } catch {
            showToast('Could not load folders', 'error');
        }
    };

    const handleMoveConfirm = async (targetFolderId: string | null) => {
        try {
            await apiClient.post('/files/bulk', { ids: [item.id], action: 'move', folder_id: targetFolderId });
            emitFileUpdated(item.id, { folder_id: targetFolderId });
            syncAfterFileMutation();
            showToast('Moved successfully');
            setMoveVisible(false);
            onClose();
            onRefresh?.();
        } catch {
            showToast('Could not move item', 'error');
        }
    };

    // Derived flags to determine which level of UI to show
    const showOptionsList = visible && !isRenameVisible && !isMoveVisible && !isShareVisible;

    return (
        <React.Fragment>
            {/* Main Options Sheet */}
            <Modal visible={showOptionsList} transparent animationType="slide">
                <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
                    <View style={s.sheet}>
                        <View style={s.handle} />
                        <Text style={s.title}>{sanitizeDisplayName(item.name || item.file_name || 'File', 'File')}</Text>

                        <ActionRow style={s.row} onPress={() => setShareVisible(true)}>
                            <Share2 color={theme.colors.primary} size={20} />
                            <Text style={s.rowText}>Share Link</Text>
                        </ActionRow>

                        <ActionRow style={s.row} onPress={() => { setRenameValue(sanitizeFileName(item.name || item.file_name || '', 'file')); setRenameVisible(true); }}>
                            <Tag color={theme.colors.textHeading} size={20} />
                            <Text style={s.rowText}>Rename</Text>
                        </ActionRow>

                        {!isFolder && (
                            <ActionRow style={s.row} onPress={handleStar}>
                                <Star color={item.is_starred ? '#F59E0B' : theme.colors.textHeading} size={20} fill={item.is_starred ? '#F59E0B' : 'transparent'} />
                                <Text style={s.rowText}>{item.is_starred ? 'Unstar' : 'Star'}</Text>
                            </ActionRow>
                        )}

                        <ActionRow style={s.row} onPress={handleMoveInit}>
                            <Move color={theme.colors.textHeading} size={20} />
                            <Text style={s.rowText}>Move to Folder</Text>
                        </ActionRow>

                        <ActionRow style={[s.row, { backgroundColor: isDark ? 'rgba(239,68,68,0.1)' : '#FEF2F2', marginTop: 8 }]} onPress={handleDelete}>
                            <Trash2 color="#EF4444" size={20} />
                            <Text style={[s.rowText, { color: '#EF4444' }]}>Move to Trash</Text>
                        </ActionRow>
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* Rename Modal */}
            <Modal visible={isRenameVisible} transparent animationType="fade">
                <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.centeredOverlay}>
                    <View style={s.modalCard}>
                        <Text style={s.title}>Rename</Text>
                        <TextInput
                            style={s.input}
                            value={renameValue}
                            onChangeText={setRenameValue}
                            placeholder="New name..."
                            placeholderTextColor={theme.colors.textBody}
                            autoFocus
                            onSubmitEditing={handleRename}
                        />
                        <View style={s.modalBtns}>
                            <AppButton label="Cancel" variant="secondary" onPress={() => setRenameVisible(false)} />
                            <AppButton label="Rename" onPress={handleRename} loading={isRenaming} disabled={!sanitizeFileName(renameValue, '').trim() || isRenaming} />
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* Move Modal */}
            <Modal visible={isMoveVisible} transparent animationType="slide">
                <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setMoveVisible(false)}>
                    <View style={[s.sheet, { paddingBottom: 40 }]}>
                        <View style={s.handle} />
                        <Text style={s.title}>Move "{sanitizeDisplayName(item.name || item.file_name || 'File', 'File')}" to...</Text>
                        
                        <TouchableOpacity style={s.moveRow} onPress={() => handleMoveConfirm(null)}>
                            <Folder color={theme.colors.primary} size={20} />
                            <Text style={s.moveRowText}>Home (Root)</Text>
                        </TouchableOpacity>

                        {allFolders.filter(f => f.id !== item.id).map(f => (
                            <TouchableOpacity key={f.id} style={s.moveRow} onPress={() => handleMoveConfirm(f.id)}>
                                <Folder color="#D97706" size={20} />
                                <Text style={s.moveRowText}>{f.name}</Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* Share Modal */}
            {isShareVisible && (
                <ShareFolderModal
                    visible={isShareVisible}
                    onClose={() => setShareVisible(false)}
                    targetItem={item}
                />
            )}
        </React.Fragment>
    );
}

const createStyles = (C: any, isDark: boolean) => StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    centeredOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    sheet: {
        backgroundColor: C.colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
        padding: 24, paddingBottom: 40,
    },
    handle: { width: 40, height: 4, backgroundColor: C.colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 20 },
    title: { fontSize: 18, fontWeight: '700', color: C.colors.textHeading, marginBottom: 16 },
    row: {
        flexDirection: 'row', alignItems: 'center', gap: 16,
        paddingVertical: 14, paddingHorizontal: 16,
        borderRadius: 16, backgroundColor: C.colors.background, marginBottom: 8
    },
    rowText: { fontSize: 16, fontWeight: '600', color: C.colors.textHeading },
    modalCard: { width: '100%', backgroundColor: C.colors.card, borderRadius: 24, padding: 24 },
    input: {
        width: '100%', height: 50, borderWidth: 1.5, borderColor: C.colors.border, borderRadius: 12,
        paddingHorizontal: 16, fontSize: 16, marginBottom: 20, color: C.colors.textHeading, backgroundColor: C.colors.background
    },
    modalBtns: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
    moveRow: {
        flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10,
        paddingHorizontal: 16, paddingVertical: 12, width: '100%', backgroundColor: C.colors.background, borderRadius: 12
    },
    moveRowText: { color: C.colors.textHeading, fontSize: 15, fontWeight: '600' }
});
