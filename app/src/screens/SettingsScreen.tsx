/**
 * SettingsScreen.tsx — Premium minimal settings
 *
 * ✅ Clean card sections with soft shadows
 * ✅ Consistent row height & spacing
 * ✅ Switch toggles for preferences
 * ✅ Danger zone with isolated red styling
 * ✅ Dark mode compatible
 * ✅ Press-scale micro-interactions
 * ✅ Smooth fade-in on mount
 */

import React, { useState, useContext, useEffect, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView,
    TouchableOpacity, Switch, Alert, Platform, Animated, Pressable,
} from 'react-native';
import {
    ArrowLeft, Shield, HardDrive, Bell, Moon, Info,
    LogOut, Trash2, ChevronRight, CheckCircle, BarChart2, Link as LinkIcon
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import apiClient from '../services/apiClient';

// ─── Pressable with scale animation ─────────────────────────────────────────

function PressRow({
    children, onPress, style, disabled,
}: {
    children: React.ReactNode; onPress?: () => void; style?: any; disabled?: boolean;
}) {
    const scale = useRef(new Animated.Value(1)).current;
    const press = () => Animated.spring(scale, { toValue: 0.97, tension: 300, friction: 20, useNativeDriver: true }).start();
    const release = () => Animated.spring(scale, { toValue: 1, tension: 300, friction: 20, useNativeDriver: true }).start();

    if (!onPress) return <View style={style}>{children}</View>;

    return (
        <Pressable onPress={onPress} onPressIn={press} onPressOut={release} disabled={disabled}>
            <Animated.View style={[style, { transform: [{ scale }] }]}>
                {children}
            </Animated.View>
        </Pressable>
    );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function SettingsScreen({ navigation }: any) {
    const { logout, user } = useContext(AuthContext);
    const { showToast } = useToast();
    const { theme, isDark, toggleTheme } = useTheme();
    const C = theme.colors;

    const [notificationsEnabled, setNotificationsEnabled] = useState(true);
    const [autoBackup, setAutoBackup] = useState(false);
    const [isDeletingAccount, setIsDeletingAccount] = useState(false);

    // Fade-in
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(16)).current;

    useEffect(() => {
        AsyncStorage.getItem('notificationsEnabled').then(val => {
            if (val !== null) setNotificationsEnabled(val === 'true');
        });
        Animated.parallel([
            Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
            Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
        ]).start();
    }, []);

    const toggleNotifications = (val: boolean) => {
        setNotificationsEnabled(val);
        AsyncStorage.setItem('notificationsEnabled', String(val));
    };

    const handleLogout = useCallback(() => {
        const confirm = async () => {
            try { await logout(); }
            catch { showToast('Sign out failed', 'error'); }
        };
        if (Platform.OS === 'web') {
            if (window.confirm('Sign out?')) confirm();
        } else {
            Alert.alert('Sign Out', 'Are you sure?', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign Out', style: 'destructive', onPress: confirm },
            ]);
        }
    }, [logout, showToast]);

    const deleteAccount = useCallback(async () => {
        if (isDeletingAccount) return;
        setIsDeletingAccount(true);
        try {
            const res = await apiClient.delete('/auth/account');
            if (!res?.data?.success) {
                throw new Error(res?.data?.error || 'Delete failed');
            }
            showToast('Account deleted permanently', 'success');
            await logout();
        } catch (e: any) {
            const message = e?.response?.data?.error || e?.message || 'Could not delete account. Contact support.';
            showToast(message, 'error');
        } finally {
            setIsDeletingAccount(false);
        }
    }, [isDeletingAccount, logout, showToast]);

    const handleDeleteAccount = useCallback(() => {
        const confirmationText = 'This will permanently delete your account and all files. This cannot be undone.';
        if (Platform.OS === 'web') {
            if (window.confirm(confirmationText)) {
                void deleteAccount();
            }
            return;
        }

        Alert.alert(
            'Delete Account',
            confirmationText,
            [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete Everything', style: 'destructive', onPress: () => void deleteAccount() },
            ]
        );
    }, [deleteAccount]);

    // ── Row Component ────────────────────────────────────────────────────────

    const Row = ({
        icon, title, subtitle, onPress, right, danger,
    }: {
        icon: React.ReactNode; title: string; subtitle?: string;
        onPress?: () => void; right?: React.ReactNode; danger?: boolean;
    }) => (
        <PressRow onPress={onPress} style={st.row}>
            <View style={[
                st.rowIcon,
                {
                    backgroundColor: danger
                        ? (isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)')
                        : (isDark ? C.primaryLight : '#EEF1FD')
                },
            ]}>
                {icon}
            </View>
            <View style={st.rowText}>
                <Text style={[st.rowTitle, { color: danger ? C.danger : C.textHeading }]}>
                    {title}
                </Text>
                {subtitle && (
                    <Text style={[st.rowSub, { color: C.muted }]}>{subtitle}</Text>
                )}
            </View>
            {right ?? (onPress && <ChevronRight color={C.muted} size={18} />)}
        </PressRow>
    );

    return (
        <SafeAreaView style={[st.root, { backgroundColor: C.background }]}>
            {/* ── Header ── */}
            <View style={st.header}>
                <TouchableOpacity
                    onPress={() => navigation?.goBack()}
                    style={[st.headerBtn, { backgroundColor: C.card }]}
                    activeOpacity={0.7}
                >
                    <ArrowLeft color={C.textHeading} size={20} />
                </TouchableOpacity>
                <Text style={[st.headerTitle, { color: C.textHeading }]}>Settings</Text>
                <View style={{ width: 40 }} />
            </View>

            <Animated.ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={st.scroll}
                style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
            >
                {/* ── Account Card ── */}
                <View style={[st.card, { backgroundColor: C.card }, theme.shadows.card]}>
                    <View style={st.accountRow}>
                        <View style={[st.accountAvatar, { backgroundColor: C.primary }]}>
                            <Text style={st.accountAvatarText}>
                                {(user?.name || user?.phone || '?')[0].toUpperCase()}
                            </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[st.accountName, { color: C.textHeading }]}>
                                {user?.name || 'Axya User'}
                            </Text>
                            <Text style={[st.accountSub, { color: C.muted }]}>
                                {user?.phone || 'No phone linked'}
                            </Text>
                        </View>
                    </View>
                </View>

                {/* ── Storage ── */}
                <Text style={[st.sectionLabel, { color: C.muted }]}>STORAGE</Text>
                <View style={[st.card, { backgroundColor: C.card }, theme.shadows.card]}>
                    <Row
                        icon={<HardDrive color={C.primary} size={20} />}
                        title="Storage Plan"
                        subtitle="Free — Unlimited Storage"
                        onPress={() => showToast('Upgrade coming soon!')}
                    />
                    <View style={[st.divider, { backgroundColor: C.border }]} />
                    <Row
                        icon={<CheckCircle color={C.success} size={20} />}
                        title="Telegram Storage"
                        subtitle="Powered by your Saved Messages"
                    />
                </View>

                {/* ── Preferences ── */}
                <Text style={[st.sectionLabel, { color: C.muted }]}>PREFERENCES</Text>
                <View style={[st.card, { backgroundColor: C.card }, theme.shadows.card]}>
                    <Row
                        icon={<Bell color="#F59E0B" size={20} />}
                        title="Upload Notifications"
                        subtitle="Notify when upload completes"
                        right={
                            <Switch
                                value={notificationsEnabled}
                                onValueChange={toggleNotifications}
                                trackColor={{ true: C.primary, false: C.border }}
                                thumbColor="#fff"
                            />
                        }
                    />
                    <View style={[st.divider, { backgroundColor: C.border }]} />
                    <Row
                        icon={<Moon color={isDark ? '#A855F7' : '#9333EA'} size={20} />}
                        title="Dark Mode"
                        subtitle={isDark ? 'Dark theme active' : 'Light theme active'}
                        right={
                            <Switch
                                value={isDark}
                                onValueChange={toggleTheme}
                                trackColor={{ true: C.primary, false: C.border }}
                                thumbColor="#fff"
                            />
                        }
                    />
                    <View style={[st.divider, { backgroundColor: C.border }]} />
                    <Row
                        icon={<HardDrive color="#0D9488" size={20} />}
                        title="Auto Backup"
                        subtitle="Coming soon"
                        right={
                            <Switch
                                value={autoBackup}
                                onValueChange={setAutoBackup}
                                trackColor={{ true: C.primary, false: C.border }}
                                thumbColor="#fff"
                                disabled
                            />
                        }
                    />
                </View>

                {/* ── Insights & Sharing ── */}
                <Text style={[st.sectionLabel, { color: C.muted }]}>INSIGHTS & SHARING</Text>
                <View style={[st.card, { backgroundColor: C.card }, theme.shadows.card]}>
                    <Row
                        icon={<BarChart2 color={C.primary} size={20} />}
                        title="Storage Analytics"
                        subtitle="Breakdown by file type"
                        onPress={() => navigation.navigate('Analytics')}
                    />
                    <View style={[st.divider, { backgroundColor: C.border }]} />
                    <Row
                        icon={<LinkIcon color="#10B981" size={20} />}
                        title="Shared Links"
                        subtitle="Manage active public links"
                        onPress={() => navigation.navigate('SharedLinks')}
                    />
                </View>

                {/* ── Security ── */}
                <Text style={[st.sectionLabel, { color: C.muted }]}>SECURITY</Text>
                <View style={[st.card, { backgroundColor: C.card }, theme.shadows.card]}>
                    <Row
                        icon={<Shield color={C.primary} size={20} />}
                        title="End-to-End Encrypted"
                        subtitle="Files stored via Telegram MTProto"
                    />
                </View>

                {/* ── About ── */}
                <Text style={[st.sectionLabel, { color: C.muted }]}>ABOUT</Text>
                <View style={[st.card, { backgroundColor: C.card }, theme.shadows.card]}>
                    <Row
                        icon={<Info color={C.muted} size={20} />}
                        title="App Version"
                        subtitle="Axya v1.0.0"
                    />
                </View>

                {/* ── Danger Zone ── */}
                <Text style={[st.sectionLabel, { color: C.muted }]}>ACCOUNT</Text>
                <View style={[st.card, { backgroundColor: C.card }, theme.shadows.card]}>
                    <Row
                        icon={<LogOut color={C.danger} size={20} />}
                        title="Sign Out"
                        onPress={handleLogout}
                        danger
                    />
                    <View style={[st.divider, { backgroundColor: C.border }]} />
                    <Row
                        icon={<Trash2 color={C.danger} size={20} />}
                        title={isDeletingAccount ? 'Deleting Account...' : 'Delete Account'}
                        subtitle="Permanently removes all data"
                        onPress={isDeletingAccount ? undefined : handleDeleteAccount}
                        danger
                    />
                </View>

                <View style={{ height: 60 }} />
            </Animated.ScrollView>
        </SafeAreaView>
    );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const st = StyleSheet.create({
    root: { flex: 1 },

    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: Platform.OS === 'web' ? 44 : 16,
        paddingBottom: 8,
    },
    headerBtn: {
        width: 40, height: 40, borderRadius: 14,
        justifyContent: 'center', alignItems: 'center',
        ...Platform.select({
            ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 6 },
            android: { elevation: 2 },
        }),
    },
    headerTitle: {
        fontSize: 17, fontWeight: '700', letterSpacing: -0.3,
    },

    scroll: { paddingHorizontal: 20, paddingTop: 8 },

    // ── Account ──────────────────────────────────────────────────────────────
    accountRow: {
        flexDirection: 'row', alignItems: 'center', gap: 16,
        paddingHorizontal: 20, paddingVertical: 20,
    },
    accountAvatar: {
        width: 48, height: 48, borderRadius: 24,
        justifyContent: 'center', alignItems: 'center',
    },
    accountAvatarText: {
        color: '#fff', fontSize: 20, fontWeight: '700',
    },
    accountName: {
        fontSize: 16, fontWeight: '700', marginBottom: 2, letterSpacing: -0.2,
    },
    accountSub: {
        fontSize: 13, fontWeight: '500',
    },

    // ── Card ─────────────────────────────────────────────────────────────────
    card: {
        borderRadius: 20, overflow: 'hidden', marginBottom: 24,
    },

    sectionLabel: {
        fontSize: 11, fontWeight: '700', letterSpacing: 1.2,
        marginBottom: 10, marginTop: 4, paddingLeft: 4,
        textTransform: 'uppercase',
    },

    // ── Row ──────────────────────────────────────────────────────────────────
    row: {
        flexDirection: 'row', alignItems: 'center',
        paddingHorizontal: 16, paddingVertical: 14, gap: 14,
    },
    rowIcon: {
        width: 38, height: 38, borderRadius: 11,
        justifyContent: 'center', alignItems: 'center',
    },
    rowText: { flex: 1 },
    rowTitle: { fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
    rowSub: { fontSize: 12, marginTop: 2 },

    divider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 68,
    },
});
