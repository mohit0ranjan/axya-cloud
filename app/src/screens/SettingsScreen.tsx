import React, { useState, useContext, useEffect } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView, ScrollView,
    TouchableOpacity, Switch, Alert, Platform,
} from 'react-native';
import {
    ArrowLeft, Shield, HardDrive, Bell, Moon, Info,
    LogOut, Trash2, ChevronRight, CheckCircle, BarChart2,
} from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import apiClient from '../services/apiClient';
import { theme } from '../ui/theme';

export default function SettingsScreen({ navigation }: any) {
    const { logout, user } = useContext(AuthContext);
    const { showToast } = useToast();
    const { theme, isDark, toggleTheme } = useTheme();
    const C = theme.colors;

    const [notificationsEnabled, setNotificationsEnabled] = useState(true);
    const [autoBackup, setAutoBackup] = useState(false);

    // Load persisted notification preference on mount
    useEffect(() => {
        AsyncStorage.getItem('notificationsEnabled').then(val => {
            if (val !== null) setNotificationsEnabled(val === 'true');
        });
    }, []);

    const toggleNotifications = (val: boolean) => {
        setNotificationsEnabled(val);
        AsyncStorage.setItem('notificationsEnabled', String(val));
    };

    const handleLogout = () => {
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
    };

    const handleDeleteAccount = () => {
        Alert.alert(
            'Delete Account',
            'This will permanently delete your account and all files. This cannot be undone.',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete Everything',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await apiClient.delete('/auth/account');
                            await logout();
                        } catch {
                            showToast('Could not delete account. Contact support.', 'error');
                        }
                    }
                },
            ]
        );
    };

    interface SettingRowProps {
        icon: React.ReactNode;
        title: string;
        subtitle?: string;
        onPress?: () => void;
        right?: React.ReactNode;
        danger?: boolean;
    }

    const SettingRow = ({ icon, title, subtitle, onPress, right, danger }: SettingRowProps) => (

        <TouchableOpacity
            style={[styles.row, { borderBottomColor: C.border }]}
            onPress={onPress}
            activeOpacity={onPress ? 0.7 : 1}
        >
            <View style={[styles.rowIcon, { backgroundColor: isDark ? C.primaryLight : '#EEF1FD' }, danger && { backgroundColor: 'rgba(255,78,78,0.1)' }]}>
                {icon}
            </View>
            <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: C.textHeading }, danger && { color: C.danger }]}>{title}</Text>
                {subtitle && <Text style={[styles.rowSub, { color: C.textBody }]}>{subtitle}</Text>}
            </View>
            {right ?? (onPress && <ChevronRight color={C.textBody} size={18} />)}
        </TouchableOpacity>
    );

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: C.background }]}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation?.goBack()} style={styles.backBtn}>
                    <ArrowLeft color={C.textHeading} size={24} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: C.textHeading }]}>Settings</Text>
                <View style={{ width: 32 }} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

                {/* ── Account Info ── */}
                <View style={[styles.profileCard, { backgroundColor: C.card }]}>
                    <View style={[styles.avatar, { backgroundColor: C.primary }]}>
                        <Text style={styles.avatarText}>
                            {(user?.name || user?.phone || '?')[0].toUpperCase()}
                        </Text>
                    </View>
                    <View>
                        <Text style={[styles.profileName, { color: C.textHeading }]}>{user?.name || 'Axya User'}</Text>
                        <Text style={[styles.profileSub, { color: C.textBody }]}>{user?.phone || 'No phone linked'}</Text>
                    </View>
                </View>

                {/* ── Storage ── */}
                <Text style={[styles.sectionLabel, { color: C.textBody }]}>STORAGE</Text>
                <View style={[styles.card, { backgroundColor: C.card }]}>
                    <SettingRow
                        icon={<HardDrive color={C.primary} size={20} />}
                        title="Storage Plan"
                        subtitle="Free — 5 GB included"
                        onPress={() => showToast('Upgrade coming soon!')}
                    />
                    <View style={[styles.divider, { backgroundColor: C.border }]} />
                    <SettingRow
                        icon={<CheckCircle color={C.success} size={20} />}
                        title="Telegram Storage"
                        subtitle="Powered by your Saved Messages"
                    />
                </View>

                {/* ── Preferences ── */}
                <Text style={[styles.sectionLabel, { color: C.textBody }]}>PREFERENCES</Text>
                <View style={[styles.card, { backgroundColor: C.card }]}>
                    <SettingRow
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
                    <View style={[styles.divider, { backgroundColor: C.border }]} />
                    <SettingRow
                        icon={<Moon color={isDark ? '#A855F7' : '#9333EA'} size={20} />}
                        title="Dark Mode"
                        subtitle={isDark ? 'Currently using dark theme' : 'Currently using light theme'}
                        right={
                            <Switch
                                value={isDark}
                                onValueChange={toggleTheme}
                                trackColor={{ true: C.primary, false: C.border }}
                                thumbColor="#fff"
                            />
                        }
                    />
                    <View style={[styles.divider, { backgroundColor: C.border }]} />
                    <SettingRow
                        icon={<HardDrive color="#0D9488" size={20} />}
                        title="Auto Backup"
                        subtitle="Experimental — coming soon"
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

                {/* ── Analytics ── */}
                <Text style={[styles.sectionLabel, { color: C.textBody }]}>INSIGHTS</Text>
                <View style={[styles.card, { backgroundColor: C.card }]}>
                    <SettingRow
                        icon={<BarChart2 color={C.primary} size={20} />}
                        title="Storage Analytics"
                        subtitle="Breakdown by file type, usage stats"
                        onPress={() => navigation.navigate('Analytics')}
                    />
                </View>

                {/* ── Security ── */}
                <Text style={[styles.sectionLabel, { color: C.textBody }]}>SECURITY</Text>
                <View style={[styles.card, { backgroundColor: C.card }]}>
                    <SettingRow
                        icon={<Shield color={C.primary} size={20} />}
                        title="End-to-End Encrypted"
                        subtitle="Files are stored encrypted via Telegram MTProto"
                    />
                </View>

                {/* ── About ── */}
                <Text style={[styles.sectionLabel, { color: C.textBody }]}>ABOUT</Text>
                <View style={[styles.card, { backgroundColor: C.card }]}>
                    <SettingRow
                        icon={<Info color={C.muted} size={20} />}
                        title="App Version"
                        subtitle="Axya v1.0.0"
                    />
                </View>

                {/* ── Danger Zone ── */}
                <Text style={[styles.sectionLabel, { color: C.textBody }]}>ACCOUNT</Text>
                <View style={[styles.card, { backgroundColor: C.card }]}>
                    <SettingRow
                        icon={<LogOut color={C.danger} size={20} />}
                        title="Sign Out"
                        onPress={handleLogout}
                        danger
                    />
                    <View style={[styles.divider, { backgroundColor: C.border }]} />
                    <SettingRow
                        icon={<Trash2 color={C.danger} size={20} />}
                        title="Delete Account"
                        subtitle="Permanently removes all data"
                        onPress={handleDeleteAccount}
                        danger
                    />
                </View>

                <View style={{ height: 60 }} />
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 20, fontWeight: '700' },

    content: { paddingHorizontal: 20, paddingTop: 8 },

    profileCard: {
        flexDirection: 'row', alignItems: 'center', gap: 16,
        borderRadius: 20, padding: 20, marginBottom: 24,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
    },
    avatar: {
        width: 52, height: 52, borderRadius: 26,
        justifyContent: 'center', alignItems: 'center',
    },
    avatarText: { color: '#fff', fontSize: 22, fontWeight: '700' },
    profileName: { fontSize: 17, fontWeight: '700', marginBottom: 3 },
    profileSub: { fontSize: 13 },

    sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, marginBottom: 10, marginTop: 6, paddingLeft: 4 },

    card: {
        borderRadius: 20, overflow: 'hidden', marginBottom: 24,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
    },

    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
    rowIcon: { width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    rowText: { flex: 1 },
    rowTitle: { fontSize: 15, fontWeight: '600' },
    rowSub: { fontSize: 12, marginTop: 2 },
    divider: { height: 1, marginHorizontal: 16 },
});

