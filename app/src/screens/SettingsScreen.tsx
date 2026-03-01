import React, { useState, useContext } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView, ScrollView,
    TouchableOpacity, Switch, Alert, Platform,
} from 'react-native';
import {
    ArrowLeft, Shield, HardDrive, Bell, Moon, Info,
    LogOut, Trash2, ChevronRight, CheckCircle, BarChart2,
} from 'lucide-react-native';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import apiClient from '../api/client';
import { theme } from '../ui/theme';

const C = {
    bg: '#F4F6FB',
    card: '#FFFFFF',
    primary: '#4B6EF5',
    danger: '#FF4E4E',
    success: '#1FD45A',
    text: '#1A1F36',
    muted: '#8892A4',
    border: '#EAEDF3',
};

interface SettingRowProps {
    icon: React.ReactNode;
    title: string;
    subtitle?: string;
    onPress?: () => void;
    right?: React.ReactNode;
    danger?: boolean;
}

function SettingRow({ icon, title, subtitle, onPress, right, danger }: SettingRowProps) {
    return (
        <TouchableOpacity
            style={styles.row}
            onPress={onPress}
            activeOpacity={onPress ? 0.7 : 1}
        >
            <View style={[styles.rowIcon, danger && { backgroundColor: 'rgba(255,78,78,0.1)' }]}>
                {icon}
            </View>
            <View style={styles.rowText}>
                <Text style={[styles.rowTitle, danger && { color: C.danger }]}>{title}</Text>
                {subtitle && <Text style={styles.rowSub}>{subtitle}</Text>}
            </View>
            {right ?? (onPress && <ChevronRight color={C.muted} size={18} />)}
        </TouchableOpacity>
    );
}

export default function SettingsScreen({ navigation }: any) {
    const { logout, user } = useContext(AuthContext);
    const { showToast } = useToast();
    const { isDark, toggleTheme } = useTheme();

    const [notificationsEnabled, setNotificationsEnabled] = useState(true);
    const [autoBackup, setAutoBackup] = useState(false);

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

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => navigation?.goBack()} style={styles.backBtn}>
                    <ArrowLeft color={C.text} size={24} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Settings</Text>
                <View style={{ width: 32 }} />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

                {/* ── Account Info ── */}
                <View style={styles.profileCard}>
                    <View style={styles.avatar}>
                        <Text style={styles.avatarText}>
                            {(user?.name || user?.phone || '?')[0].toUpperCase()}
                        </Text>
                    </View>
                    <View>
                        <Text style={styles.profileName}>{user?.name || 'TeleDrive User'}</Text>
                        <Text style={styles.profileSub}>{user?.phone || 'No phone linked'}</Text>
                    </View>
                </View>

                {/* ── Storage ── */}
                <Text style={styles.sectionLabel}>STORAGE</Text>
                <View style={styles.card}>
                    <SettingRow
                        icon={<HardDrive color={C.primary} size={20} />}
                        title="Storage Plan"
                        subtitle="Free — 5 GB included"
                        onPress={() => showToast('Upgrade coming soon!')}
                    />
                    <View style={styles.divider} />
                    <SettingRow
                        icon={<CheckCircle color={C.success} size={20} />}
                        title="Telegram Storage"
                        subtitle="Powered by your Saved Messages"
                    />
                </View>

                {/* ── Preferences ── */}
                <Text style={styles.sectionLabel}>PREFERENCES</Text>
                <View style={styles.card}>
                    <SettingRow
                        icon={<Bell color="#F59E0B" size={20} />}
                        title="Upload Notifications"
                        subtitle="Notify when upload completes"
                        right={
                            <Switch
                                value={notificationsEnabled}
                                onValueChange={setNotificationsEnabled}
                                trackColor={{ true: C.primary, false: C.border }}
                                thumbColor="#fff"
                            />
                        }
                    />
                    <View style={styles.divider} />
                    <SettingRow
                        icon={<Moon color="#9333EA" size={20} />}
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
                    <View style={styles.divider} />
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
                <Text style={styles.sectionLabel}>INSIGHTS</Text>
                <View style={styles.card}>
                    <SettingRow
                        icon={<BarChart2 color={C.primary} size={20} />}
                        title="Storage Analytics"
                        subtitle="Breakdown by file type, usage stats"
                        onPress={() => navigation.navigate('Analytics')}
                    />
                </View>

                {/* ── Security ── */}
                <Text style={styles.sectionLabel}>SECURITY</Text>
                <View style={styles.card}>
                    <SettingRow
                        icon={<Shield color={C.primary} size={20} />}
                        title="End-to-End Encrypted"
                        subtitle="Files are stored encrypted via Telegram MTProto"
                    />
                </View>

                {/* ── About ── */}
                <Text style={styles.sectionLabel}>ABOUT</Text>
                <View style={styles.card}>
                    <SettingRow
                        icon={<Info color={C.muted} size={20} />}
                        title="App Version"
                        subtitle="TeleDrive v1.0.0"
                    />
                </View>

                {/* ── Danger Zone ── */}
                <Text style={styles.sectionLabel}>ACCOUNT</Text>
                <View style={styles.card}>
                    <SettingRow
                        icon={<LogOut color={C.danger} size={20} />}
                        title="Sign Out"
                        onPress={handleLogout}
                        danger
                    />
                    <View style={styles.divider} />
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
    container: { flex: 1, backgroundColor: C.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 20, fontWeight: '700', color: C.text },

    content: { paddingHorizontal: 20, paddingTop: 8 },

    profileCard: {
        flexDirection: 'row', alignItems: 'center', gap: 16,
        backgroundColor: C.card, borderRadius: 20, padding: 20, marginBottom: 24,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
    },
    avatar: {
        width: 52, height: 52, borderRadius: 26, backgroundColor: C.primary,
        justifyContent: 'center', alignItems: 'center',
    },
    avatarText: { color: '#fff', fontSize: 22, fontWeight: '700' },
    profileName: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 3 },
    profileSub: { fontSize: 13, color: C.muted },

    sectionLabel: { fontSize: 11, fontWeight: '700', color: C.muted, letterSpacing: 1, marginBottom: 10, marginTop: 6, paddingLeft: 4 },

    card: {
        backgroundColor: C.card, borderRadius: 20, overflow: 'hidden', marginBottom: 24,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3,
    },

    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
    rowIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#EEF1FD', justifyContent: 'center', alignItems: 'center' },
    rowText: { flex: 1 },
    rowTitle: { fontSize: 15, fontWeight: '600', color: C.text },
    rowSub: { fontSize: 12, color: C.muted, marginTop: 2 },
    divider: { height: 1, backgroundColor: C.border, marginHorizontal: 16 },
});
