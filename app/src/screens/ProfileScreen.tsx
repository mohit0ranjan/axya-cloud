import React, { useState, useEffect, useContext } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView, ScrollView,
    TouchableOpacity, Alert, Platform,
} from 'react-native';
import {
    ArrowLeft, LogOut, User, HardDrive, Star,
    Trash2, ChevronRight, Activity, Shield, Cloud,
} from 'lucide-react-native';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import apiClient from '../api/client';
import { SkeletonBlock } from '../ui/Skeleton';

const C = {
    bg: '#F4F6FB', card: '#FFFFFF', primary: '#4B6EF5',
    accent: '#FCBD0B', danger: '#FF4E4E', success: '#1FD45A',
    text: '#1A1F36', muted: '#8892A4', border: '#EAEDF3',
};

const ACTION_ICONS: Record<string, string> = {
    upload: '⬆️', delete_permanent: '🗑️', trash: '🗂️',
    restore: '↩️', rename: '✏️', create_folder: '📁', move: '📦',
};

export default function ProfileScreen({ navigation }: any) {
    // ✅ Connect to AuthContext at the top level
    const authCtx = useContext(AuthContext);
    const { showToast } = useToast();

    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>({});
    const [activity, setActivity] = useState<any[]>([]);

    useEffect(() => { fetchAll(); }, []);

    const fetchAll = async () => {
        try {
            const [statsRes, actRes] = await Promise.all([
                apiClient.get('/files/stats'),
                apiClient.get('/files/activity'),
            ]);
            if (statsRes.data.success) setStats(statsRes.data);
            if (actRes.data.success) setActivity(actRes.data.activity.slice(0, 20));
        } catch {
            showToast('Could not load profile', 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleLogout = async () => {
        if (Platform.OS === 'web') {
            if (window.confirm('Are you sure you want to sign out?')) {
                try { await authCtx.logout(); }
                catch (e) { showToast('Sign out failed, try again', 'error'); }
            }
            return;
        }

        Alert.alert(
            'Sign Out',
            'Are you sure you want to sign out?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Sign Out',
                    style: 'destructive',
                    onPress: async () => {
                        try { await authCtx.logout(); }
                        catch (e) { showToast('Sign out failed, try again', 'error'); }
                    },
                },
            ],
            { cancelable: true }
        );
    };

    const formatSize = (bytes: number) => {
        if (!bytes) return '0 B';
        const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + s[i];
    };

    const formatDate = (d: string) =>
        new Date(d).toLocaleString('en-US', {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });

    return (
        <SafeAreaView style={s.root}>
            {/* ── Header ── */}
            <View style={s.header}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <ArrowLeft color={C.text} size={24} />
                </TouchableOpacity>
                <Text style={s.headerTitle}>My Profile</Text>
                <TouchableOpacity style={s.logoutHeaderBtn} onPress={handleLogout}>
                    <LogOut color={C.danger} size={22} />
                </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>

                {/* ── Profile Hero Card ── */}
                <View style={s.heroCard}>
                    <View style={s.avatarCircle}>
                        <User color="#fff" size={38} />
                    </View>
                    {loading ? (
                        <>
                            <SkeletonBlock width={160} height={20} borderRadius={8} style={{ marginTop: 18 }} />
                            <SkeletonBlock width={120} height={13} borderRadius={6} style={{ marginTop: 8 }} />
                        </>
                    ) : (
                        <>
                            <Text style={s.profileName}>{authCtx.user?.name || authCtx.user?.username || authCtx.user?.phone || 'TeleDrive User'}</Text>
                            <Text style={s.profilePhone}>{authCtx.user?.phone}</Text>

                        </>
                    )}
                </View>

                {/* ── Stats Grid ── */}
                <Text style={s.sectionTitle}>Storage Overview</Text>
                <View style={s.statsGrid}>
                    {[
                        { label: 'Total Files', value: stats.totalFiles ?? '—', icon: <HardDrive color={C.primary} size={20} />, bg: '#EEF1FD' },
                        { label: 'Space Used', value: formatSize(stats.totalBytes || 0), icon: <Cloud color={C.success} size={20} />, bg: '#DCFCE7' },
                        { label: 'Starred', value: stats.starredCount ?? '—', icon: <Star color={C.accent} size={20} />, bg: '#FEF3C7' },
                        { label: 'In Trash', value: stats.trashCount ?? '—', icon: <Trash2 color={C.danger} size={20} />, bg: '#FEE2E2' },
                    ].map((item, i) => (
                        <View key={i} style={s.statCard}>
                            <View style={[s.statIcon, { backgroundColor: item.bg }]}>
                                {item.icon}
                            </View>
                            <Text style={s.statVal}>{loading ? '—' : item.value}</Text>
                            <Text style={s.statLbl}>{item.label}</Text>
                        </View>
                    ))}
                </View>

                {/* ── Quick Nav ── */}
                <Text style={s.sectionTitle}>Drive</Text>
                <View style={s.menuCard}>
                    {[
                        { label: 'Starred Files', icon: <Star color={C.accent} size={19} />, screen: 'Starred' },
                        { label: 'Trash', icon: <Trash2 color={C.danger} size={19} />, screen: 'Trash' },
                        { label: 'All Folders', icon: <HardDrive color={C.primary} size={19} />, screen: 'Folders' },
                        { label: 'Settings', icon: <Activity color={C.muted} size={19} />, screen: 'Settings' },
                    ].map((item, i, arr) => (
                        <TouchableOpacity
                            key={i}
                            style={[s.menuRow, i < arr.length - 1 && s.menuRowBorder]}
                            onPress={() => navigation.navigate(item.screen)}
                            activeOpacity={0.7}
                        >
                            <View style={s.menuIconBox}>{item.icon}</View>
                            <Text style={s.menuLabel}>{item.label}</Text>
                            <ChevronRight color={C.muted} size={18} />
                        </TouchableOpacity>
                    ))}
                </View>

                {/* ── Activity Log ── */}
                <Text style={s.sectionTitle}>Recent Activity</Text>
                <View style={s.menuCard}>
                    {loading ? (
                        [1, 2, 3].map(i => (
                            <View key={i} style={[s.menuRow, s.menuRowBorder]}>
                                <SkeletonBlock width={36} height={36} borderRadius={10} />
                                <View style={{ marginLeft: 14, flex: 1 }}>
                                    <SkeletonBlock width="60%" height={13} borderRadius={5} style={{ marginBottom: 6 }} />
                                    <SkeletonBlock width="40%" height={11} borderRadius={5} />
                                </View>
                            </View>
                        ))
                    ) : activity.length === 0 ? (
                        <View style={s.emptyAct}>
                            <Activity color="#CBD5E1" size={32} />
                            <Text style={s.emptyActTxt}>No activity yet</Text>
                        </View>
                    ) : (
                        activity.map((act, i) => (
                            <View
                                key={act.id}
                                style={[s.menuRow, i < activity.length - 1 && s.menuRowBorder]}
                            >
                                <View style={s.actEmoji}>
                                    <Text style={{ fontSize: 17 }}>
                                        {ACTION_ICONS[act.action] || '📄'}
                                    </Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={s.actTitle} numberOfLines={1}>
                                        {act.action.replace(/_/g, ' ')}{act.file_name ? `: "${act.file_name}"` : ''}
                                    </Text>
                                    <Text style={s.actDate}>{formatDate(act.created_at)}</Text>
                                </View>
                            </View>
                        ))
                    )}
                </View>

                {/* ── Sign Out Button ── */}
                <TouchableOpacity style={s.signOutBtn} onPress={handleLogout} activeOpacity={0.8}>
                    <LogOut color={C.danger} size={20} />
                    <Text style={s.signOutTxt}>Sign Out</Text>
                </TouchableOpacity>

                <View style={{ height: 48 }} />
            </ScrollView>
        </SafeAreaView>
    );
}

const s = StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingTop: Platform.OS === 'web' ? 44 : 20, paddingBottom: 14,
    },
    backBtn: { width: 40, height: 40, justifyContent: 'center' },
    headerTitle: { fontSize: 18, fontWeight: '700', color: C.text },
    logoutHeaderBtn: {
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: '#FEE2E2', justifyContent: 'center', alignItems: 'center',
    },

    content: { paddingHorizontal: 20 },

    heroCard: {
        backgroundColor: '#2B3F8C', borderRadius: 28, paddingVertical: 32,
        alignItems: 'center', marginBottom: 28,
        shadowColor: '#2B3F8C', shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.35, shadowRadius: 20, elevation: 10,
    },
    avatarCircle: {
        width: 80, height: 80, borderRadius: 40,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center', alignItems: 'center',
        borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)',
    },
    profileName: {
        fontSize: 22, fontWeight: '800', color: '#fff', marginTop: 14, letterSpacing: -0.3,
    },
    profilePhone: { fontSize: 14, color: 'rgba(255,255,255,0.65)', marginTop: 4 },
    planBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: 'rgba(255,255,255,0.15)',
        paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginTop: 14,
    },
    planText: { fontSize: 12, fontWeight: '700', color: '#fff', letterSpacing: 1 },

    sectionTitle: {
        fontSize: 16, fontWeight: '700', color: C.text,
        marginBottom: 14, marginTop: 4,
    },

    statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 28 },
    statCard: {
        width: '47%', backgroundColor: C.card, borderRadius: 20, padding: 18,
        alignItems: 'center',
        shadowColor: '#96A0B5', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.09, shadowRadius: 12, elevation: 3,
    },
    statIcon: {
        width: 44, height: 44, borderRadius: 13,
        justifyContent: 'center', alignItems: 'center', marginBottom: 10,
    },
    statVal: { fontSize: 22, fontWeight: '800', color: C.text, marginBottom: 4 },
    statLbl: { fontSize: 12, color: C.muted, fontWeight: '500', textAlign: 'center' },

    menuCard: {
        backgroundColor: C.card, borderRadius: 20, paddingHorizontal: 16,
        marginBottom: 28,
        shadowColor: '#96A0B5', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08, shadowRadius: 12, elevation: 3,
    },
    menuRow: {
        flexDirection: 'row', alignItems: 'center', paddingVertical: 15, gap: 14,
    },
    menuRowBorder: { borderBottomWidth: 1, borderBottomColor: C.border },
    menuIconBox: {
        width: 38, height: 38, borderRadius: 10,
        backgroundColor: C.bg, justifyContent: 'center', alignItems: 'center',
    },
    menuLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: C.text },

    actEmoji: {
        width: 38, height: 38, borderRadius: 10, backgroundColor: C.bg,
        justifyContent: 'center', alignItems: 'center',
    },
    actTitle: {
        fontSize: 13, fontWeight: '600', color: C.text,
        textTransform: 'capitalize', marginBottom: 3,
    },
    actDate: { fontSize: 11, color: C.muted },

    emptyAct: { paddingVertical: 28, alignItems: 'center', gap: 10 },
    emptyActTxt: { fontSize: 14, color: C.muted },

    signOutBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 10, height: 54, borderRadius: 16,
        backgroundColor: '#FEE2E2', marginBottom: 8,
    },
    signOutTxt: { fontSize: 16, fontWeight: '700', color: C.danger },
});
