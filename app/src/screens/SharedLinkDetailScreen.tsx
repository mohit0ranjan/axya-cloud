import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { ArrowLeft, Clock3, Copy, Eye, EyeOff, Link as LinkIcon, Lock, ShieldAlert, Trash2, Download, Image as ImageIcon } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { ErrorState } from '../ui/ErrorState';
import { fetchShareDetails, revokeShareLink, updateShareLink } from '../services/api';

function formatDateLabel(value?: string | null) {
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Invalid date';
    return date.toLocaleString();
}

function toExpiryIso(daysFromNow: number) {
    return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

export default function SharedLinkDetailScreen({ navigation, route }: any) {
    const shareId = String(route?.params?.shareId || '');
    const initialShare = route?.params?.initialShare || null;
    const { theme } = useTheme();
    const { showToast } = useToast();
    const C = theme.colors;
    const styles = useMemo(() => createStyles(C), [C]);
    const insets = useSafeAreaInsets();

    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [share, setShare] = useState<any>(initialShare);
    const [analytics, setAnalytics] = useState<any>(null);
    const [recentEvents, setRecentEvents] = useState<any[]>([]);
    const [loadError, setLoadError] = useState('');
    const [passwordValue, setPasswordValue] = useState('');

    const loadDetails = useCallback(async (isRefresh = false) => {
        if (!shareId) {
            setLoadError('Missing share id.');
            setLoading(false);
            setRefreshing(false);
            return;
        }
        if (isRefresh) setRefreshing(true);
        else setLoading(true);
        setLoadError('');
        try {
            const res = await fetchShareDetails(shareId);
            if (res?.success) {
                setShare(res.share || null);
                setAnalytics(res.analytics || null);
                setRecentEvents(Array.isArray(res.recentEvents) ? res.recentEvents : []);
            } else {
                throw new Error(res?.error || 'Could not load share details.');
            }
        } catch (e: any) {
            const message = e?.response?.data?.error || e?.message || 'Could not load share details.';
            setLoadError(message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [shareId]);

    useEffect(() => {
        void loadDetails();
    }, [loadDetails]);

    const applyUpdate = useCallback(async (updates: any, successMessage: string) => {
        if (!shareId) return;
        setSaving(true);
        try {
            const res = await updateShareLink(shareId, updates);
            if (!res?.success) {
                throw new Error(res?.error || 'Update failed');
            }
            showToast(successMessage, 'success');
            await loadDetails(true);
            setPasswordValue('');
        } catch (e: any) {
            const message = e?.response?.data?.error || e?.message || 'Could not update share.';
            showToast(message, 'error');
        } finally {
            setSaving(false);
        }
    }, [loadDetails, shareId, showToast]);

    const handleCopy = useCallback(async () => {
        const shareUrl = String(share?.share_url || share?.shareUrl || '').trim();
        if (!shareUrl || !/[?&]k=/.test(shareUrl)) {
            showToast('This share link cannot be reconstructed from the saved data. Recreate the share to copy a fresh URL.', 'error');
            return;
        }
        await Clipboard.setStringAsync(shareUrl);
        showToast('Link copied to clipboard', 'success');
    }, [share, showToast]);

    const handleRevoke = useCallback(() => {
        if (!shareId || saving) return;
        Alert.alert(
            'Revoke Link',
            'Anyone with this link will lose access immediately.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Revoke',
                    style: 'destructive',
                    onPress: async () => {
                        setSaving(true);
                        try {
                            const res = await revokeShareLink(shareId);
                            if (!res?.success) throw new Error(res?.error || 'Failed to revoke link.');
                            showToast('Share revoked', 'success');
                            navigation.goBack();
                        } catch (e: any) {
                            const message = e?.response?.data?.error || e?.message || 'Failed to revoke link.';
                            showToast(message, 'error');
                        } finally {
                            setSaving(false);
                        }
                    },
                },
            ]
        );
    }, [navigation, saving, shareId, showToast]);

    const expiryPills = useMemo(() => ([
        { label: '24h', value: toExpiryIso(1) },
        { label: '7d', value: toExpiryIso(7) },
        { label: '30d', value: toExpiryIso(30) },
        { label: 'Never', value: null },
    ]), []);

    if (loading) {
        return (
            <View style={[styles.container, { backgroundColor: C.background, paddingTop: insets.top }]}>
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={C.primary} />
                </View>
            </View>
        );
    }

    if (loadError && !share) {
        return (
            <View style={[styles.container, { backgroundColor: C.background, paddingTop: insets.top }]}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                        <ArrowLeft color={C.textHeading} size={24} />
                    </TouchableOpacity>
                    <Text style={[styles.title, { color: C.textHeading }]}>Share Details</Text>
                    <View style={{ width: 40 }} />
                </View>
                <ErrorState title="Could not load share" message={loadError} onRetry={() => void loadDetails()} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: C.background, paddingTop: insets.top }]}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
                    <ArrowLeft color={C.textHeading} size={24} />
                </TouchableOpacity>
                <Text style={[styles.title, { color: C.textHeading }]}>Share Details</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView
                contentContainerStyle={styles.content}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadDetails(true)} tintColor={C.primary} />}
            >
                <View style={[styles.card, { backgroundColor: C.card }]}>
                    <View style={styles.rowBetween}>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.shareSlug, { color: C.textHeading }]}>/{share?.slug}</Text>
                            <Text style={[styles.shareMeta, { color: C.textBody }]}>
                                {share?.resourceType === 'folder' ? 'Folder share' : 'File share'} · {share?.fileCount || 0} file{Number(share?.fileCount || 0) === 1 ? '' : 's'}
                            </Text>
                        </View>
                        <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: C.primary }]} onPress={() => void handleCopy()}>
                            <Copy color="#fff" size={16} />
                            <Text style={styles.primaryBtnText}>Copy Link</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.detailGrid}>
                        <DetailItem label="Created" value={formatDateLabel(share?.createdAt)} color={C.textHeading} />
                        <DetailItem label="Expires" value={formatDateLabel(share?.expiresAt)} color={C.textHeading} />
                        <DetailItem label="Password" value={share?.requiresPassword ? 'Protected' : 'Open link'} color={C.textHeading} />
                        <DetailItem label="Status" value={share?.revokedAt ? 'Revoked' : 'Active'} color={share?.revokedAt ? C.danger : C.success} />
                    </View>
                </View>

                <View style={[styles.card, { backgroundColor: C.card }]}>
                    <Text style={[styles.sectionTitle, { color: C.textHeading }]}>Analytics</Text>
                    <View style={styles.statsRow}>
                        <StatPill icon={<Eye color={C.primary} size={16} />} label="Opens" value={analytics?.opens || 0} />
                        <StatPill icon={<ImageIcon color={C.primary} size={16} />} label="Previews" value={analytics?.previews || 0} />
                        <StatPill icon={<Download color={C.primary} size={16} />} label="Downloads" value={(analytics?.downloads || 0) + (analytics?.zipDownloads || 0)} />
                        <StatPill icon={<ShieldAlert color={C.danger} size={16} />} label="Errors" value={analytics?.errors || 0} />
                    </View>
                </View>

                <View style={[styles.card, { backgroundColor: C.card }]}>
                    <Text style={[styles.sectionTitle, { color: C.textHeading }]}>Access Controls</Text>
                    <SettingRow
                        icon={share?.allowPreview ? <Eye color={C.primary} size={18} /> : <EyeOff color={C.textBody} size={18} />}
                        title="Allow preview"
                        subtitle="Visitors can preview supported files in browser"
                        value={!!share?.allowPreview}
                        disabled={saving}
                        onChange={(next) => void applyUpdate({ allow_preview: next }, next ? 'Preview enabled' : 'Preview disabled')}
                    />
                    <SettingRow
                        icon={<Download color={C.primary} size={18} />}
                        title="Allow download"
                        subtitle="Visitors can download files and ZIP archives"
                        value={!!share?.allowDownload}
                        disabled={saving}
                        onChange={(next) => void applyUpdate({ allow_download: next }, next ? 'Downloads enabled' : 'Downloads disabled')}
                    />

                    <View style={styles.passwordBlock}>
                        <View style={styles.passwordHeader}>
                            <Lock color={C.primary} size={18} />
                            <Text style={[styles.passwordTitle, { color: C.textHeading }]}>Password</Text>
                        </View>
                        <TextInput
                            style={[styles.input, { backgroundColor: C.background, borderColor: C.border, color: C.textHeading }]}
                            placeholder={share?.requiresPassword ? 'Set a new password or clear it below' : 'Set share password'}
                            placeholderTextColor={C.textBody}
                            secureTextEntry
                            value={passwordValue}
                            onChangeText={setPasswordValue}
                        />
                        <View style={styles.inlineActions}>
                            <TouchableOpacity
                                style={[styles.secondaryBtn, { borderColor: C.border }]}
                                disabled={saving || !passwordValue.trim()}
                                onPress={() => void applyUpdate({ password: passwordValue.trim() }, 'Password updated')}
                            >
                                <Text style={[styles.secondaryBtnText, { color: C.textHeading }]}>Save Password</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.secondaryBtn, { borderColor: C.border }]}
                                disabled={saving || !share?.requiresPassword}
                                onPress={() => void applyUpdate({ password: '' }, 'Password removed')}
                            >
                                <Text style={[styles.secondaryBtnText, { color: C.textHeading }]}>Clear</Text>
                            </TouchableOpacity>
                        </View>
                    </View>

                    <View style={styles.passwordBlock}>
                        <View style={styles.passwordHeader}>
                            <Clock3 color={C.primary} size={18} />
                            <Text style={[styles.passwordTitle, { color: C.textHeading }]}>Expiry</Text>
                        </View>
                        <View style={styles.pills}>
                            {expiryPills.map((pill) => (
                                <TouchableOpacity
                                    key={pill.label}
                                    style={[styles.pill, { backgroundColor: C.background, borderColor: C.border }]}
                                    disabled={saving}
                                    onPress={() => void applyUpdate({ expires_at: pill.value }, pill.value ? `Expiry set to ${pill.label}` : 'Expiry removed')}
                                >
                                    <Text style={[styles.pillText, { color: C.textHeading }]}>{pill.label}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    </View>
                </View>

                <View style={[styles.card, { backgroundColor: C.card }]}>
                    <Text style={[styles.sectionTitle, { color: C.textHeading }]}>Recent Events</Text>
                    {recentEvents.length === 0 ? (
                        <Text style={[styles.emptyEvents, { color: C.textBody }]}>No share activity recorded yet.</Text>
                    ) : (
                        recentEvents.map((event, index) => (
                            <View
                                key={`${event.eventType}-${event.createdAt}-${index}`}
                                style={[styles.eventRow, index > 0 && { borderTopColor: C.border, borderTopWidth: StyleSheet.hairlineWidth }]}
                            >
                                <View style={styles.eventText}>
                                    <Text style={[styles.eventTitle, { color: C.textHeading }]}>{String(event.eventType || '').replace(/_/g, ' ')}</Text>
                                    <Text style={[styles.eventSubtitle, { color: C.textBody }]}>
                                        {formatDateLabel(event.createdAt)}
                                        {event.errorCode ? ` · ${event.errorCode}` : ''}
                                        {event.statusCode ? ` · ${event.statusCode}` : ''}
                                    </Text>
                                </View>
                            </View>
                        ))
                    )}
                </View>

                <View style={[styles.card, { backgroundColor: C.card }]}>
                    <Text style={[styles.sectionTitle, { color: C.textHeading }]}>Danger Zone</Text>
                    <TouchableOpacity style={[styles.dangerBtn, { backgroundColor: 'rgba(239,68,68,0.08)' }]} disabled={saving} onPress={handleRevoke}>
                        <Trash2 color={C.danger} size={18} />
                        <Text style={[styles.dangerText, { color: C.danger }]}>{saving ? 'Working...' : 'Revoke Share Link'}</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </View>
    );
}

function DetailItem({ label, value, color }: { label: string; value: string; color: string }) {
    const { theme } = useTheme();
    const C = theme.colors;
    const styles = useMemo(() => createStyles(C), [C]);
    return (
        <View style={styles.detailItem}>
            <Text style={[styles.detailLabel, { color: C.textBody }]}>{label}</Text>
            <Text style={[styles.detailValue, { color }]}>{value}</Text>
        </View>
    );
}

function StatPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
    const { theme } = useTheme();
    const C = theme.colors;
    const styles = useMemo(() => createStyles(C), [C]);
    return (
        <View style={styles.statPill}>
            <View style={styles.statPillTop}>
                {icon}
                <Text style={styles.statPillLabel}>{label}</Text>
            </View>
            <Text style={styles.statPillValue}>{value}</Text>
        </View>
    );
}

function SettingRow({
    icon,
    title,
    subtitle,
    value,
    onChange,
    disabled,
}: {
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    value: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
}) {
    const { theme } = useTheme();
    const C = theme.colors;
    const styles = useMemo(() => createStyles(C), [C]);
    return (
        <View style={styles.settingRow}>
            <View style={styles.settingIcon}>{icon}</View>
            <View style={styles.settingText}>
                <Text style={styles.settingTitle}>{title}</Text>
                <Text style={styles.settingSubtitle}>{subtitle}</Text>
            </View>
            <Switch value={value} onValueChange={onChange} disabled={disabled} />
        </View>
    );
}

const createStyles = (C: any) => StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
    backBtn: { padding: 4 },
    title: { fontSize: 20, fontWeight: '700' },
    content: { padding: 20, gap: 16, paddingBottom: 40 },
    card: { borderRadius: 18, padding: 16, gap: 14 },
    rowBetween: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    shareSlug: { fontSize: 20, fontWeight: '700' },
    shareMeta: { fontSize: 13, marginTop: 4 },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14 },
    primaryBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
    detailGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    detailItem: { width: '47%', gap: 4 },
    detailLabel: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
    detailValue: { fontSize: 14, fontWeight: '600' },
    sectionTitle: { fontSize: 16, fontWeight: '700' },
    statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    statPill: { minWidth: '47%', padding: 12, borderRadius: 14, backgroundColor: C.surfaceMuted, gap: 10 },
    statPillTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    statPillLabel: { fontSize: 12, fontWeight: '600', color: C.textBody },
    statPillValue: { fontSize: 22, fontWeight: '800', color: C.textHeading },
    settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    settingIcon: { width: 36, alignItems: 'center' },
    settingText: { flex: 1 },
    settingTitle: { fontSize: 15, fontWeight: '600', color: C.textHeading },
    settingSubtitle: { fontSize: 12, color: C.textBody, marginTop: 2 },
    passwordBlock: { gap: 12, marginTop: 4 },
    passwordHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    passwordTitle: { fontSize: 15, fontWeight: '600' },
    input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
    inlineActions: { flexDirection: 'row', gap: 10 },
    secondaryBtn: { flex: 1, borderWidth: 1, borderRadius: 14, paddingVertical: 12, alignItems: 'center' },
    secondaryBtnText: { fontSize: 13, fontWeight: '700' },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
    pillText: { fontSize: 13, fontWeight: '700' },
    emptyEvents: { fontSize: 14 },
    eventRow: { paddingVertical: 12 },
    eventText: { gap: 4 },
    eventTitle: { fontSize: 14, fontWeight: '600', textTransform: 'capitalize' },
    eventSubtitle: { fontSize: 12 },
    dangerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 14, paddingVertical: 14 },
    dangerText: { fontSize: 14, fontWeight: '700' },
});
