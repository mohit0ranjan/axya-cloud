import React, { useState, useEffect, useContext } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView, ScrollView,
    TouchableOpacity, Alert, Platform, Image,
} from 'react-native';

import {
    ArrowLeft, LogOut, User, HardDrive, Star,
    Trash2, ChevronRight, Activity, Shield, Cloud,
} from 'lucide-react-native';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import apiClient from '../services/apiClient';
import { SkeletonBlock } from '../ui/Skeleton';
import { LinearGradient } from 'expo-linear-gradient';

const ACTION_ICONS: Record<string, string> = {
    upload: '⬆️', delete_permanent: '🗑️', trash: '🗂️',
    restore: '↩️', rename: '✏️', create_folder: '📁', move: '📦',
};

export default function ProfileScreen({ navigation }: any) {
    const authCtx = useContext(AuthContext);
    const { showToast } = useToast();
    const { theme } = useTheme();

    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>({});
    const [activity, setActivity] = useState<any[]>([]);

    useEffect(() => { fetchAll(); }, []);

    const fetchAll = async () => {
        setLoading(true);
        try {
            const [statsRes, actRes] = await Promise.all([
                apiClient.get('/files/stats').catch(e => {
                    return { data: { success: false } };
                }),
                apiClient.get('/files/activity').catch(e => {
                    return { data: { success: false } };
                }),
            ]);

            if (statsRes.data?.success) setStats(statsRes.data);
            if (actRes.data?.success) setActivity(actRes.data.activity.slice(0, 20));

            if (!statsRes.data?.success && !actRes.data?.success) {
                showToast('Partially could not load profile data', 'warning');
            }
        } catch { } finally { setLoading(false); }
    };

    const handleLogout = () => {
        Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign Out', style: 'destructive', onPress: () => authCtx.logout() },
        ]);
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

    const C = theme.colors;

    return (
        <SafeAreaView style={[s.root, { backgroundColor: C.background }]}>
            {/* ── Header ── */}
            <View style={s.header}>
                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                    <ArrowLeft color={C.textHeading} size={24} />
                </TouchableOpacity>
                <Text style={[s.headerTitle, { color: C.textHeading }]}>My Profile</Text>
                <TouchableOpacity style={[s.logoutHeaderBtn, { backgroundColor: 'rgba(255, 78, 78, 0.1)' }]} onPress={handleLogout}>
                    <LogOut color={C.danger} size={22} />
                </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={s.content}>

                {/* ── Premium Profile Hero Card ── */}
                <LinearGradient
                    colors={['#0F111A', '#1C2033']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.heroCard}
                >
                    {/* Floating Branding */}
                    <View style={s.cardBranding}>
                        <Image
                            source={require('../../assets/axya_logo.png')}
                            style={{ width: 24, height: 24, borderRadius: 6 }}
                            resizeMode="contain"
                        />
                        <Text style={s.cardBrandText}>Axya Cloud</Text>
                    </View>

                    {/* Avatar Ring */}
                    <View style={s.avatarOuterRing}>
                        <View style={s.avatarInnerCircle}>
                            <User color="#fff" size={32} />
                        </View>
                    </View>

                    {loading ? (
                        <View style={{ alignItems: 'center' }}>
                            <SkeletonBlock width={160} height={20} borderRadius={8} style={{ marginTop: 22, backgroundColor: 'rgba(255,255,255,0.1)' }} />
                            <SkeletonBlock width={120} height={13} borderRadius={6} style={{ marginTop: 10, backgroundColor: 'rgba(255,255,255,0.05)' }} />
                        </View>
                    ) : (
                        <>
                            <Text style={s.profileName}>{authCtx.user?.name || authCtx.user?.username || authCtx.user?.phone || 'Axya User'}</Text>
                            <Text style={s.profilePhone}>{authCtx.user?.phone}</Text>
                        </>
                    )}
                </LinearGradient>

                {/* ── Stats Grid ── */}
                <Text style={[s.sectionTitle, { color: C.textHeading }]}>Storage Overview</Text>
                <View style={s.statsGrid}>
                    {[
                        { label: 'Total Files', value: stats.totalFiles ?? '—', icon: <HardDrive color={C.primary} size={20} />, bg: theme.mode === 'dark' ? 'rgba(75, 110, 245, 0.15)' : '#EEF1FD' },
                        { label: 'Space Used', value: formatSize(stats.totalBytes || 0), icon: <Cloud color={C.success} size={20} />, bg: theme.mode === 'dark' ? 'rgba(31, 212, 90, 0.15)' : '#DCFCE7' },
                        { label: 'Starred', value: stats.starredCount ?? '—', icon: <Star color={C.accent} size={20} />, bg: theme.mode === 'dark' ? 'rgba(252, 189, 11, 0.15)' : '#FEF3C7' },
                        { label: 'In Trash', value: stats.trashCount ?? '—', icon: <Trash2 color={C.danger} size={20} />, bg: theme.mode === 'dark' ? 'rgba(255, 78, 78, 0.15)' : '#FEE2E2' },
                    ].map((item, i) => (
                        <View key={i} style={[s.statCard, { backgroundColor: C.card }]}>
                            <View style={[s.statIcon, { backgroundColor: item.bg }]}>
                                {item.icon}
                            </View>
                            <Text style={[s.statVal, { color: C.textHeading }]}>{loading ? '—' : item.value}</Text>
                            <Text style={[s.statLbl, { color: C.textBody }]}>{item.label}</Text>
                        </View>
                    ))}
                </View>

                {/* ── Quick Nav ── */}
                <Text style={[s.sectionTitle, { color: C.textHeading }]}>Drive</Text>
                <View style={[s.menuCard, { backgroundColor: C.card }]}>
                    {[
                        { label: 'Starred Files', icon: <Star color={C.accent} size={19} />, screen: 'Starred' },
                        { label: 'Trash', icon: <Trash2 color={C.danger} size={19} />, screen: 'Trash' },
                        { label: 'All Folders', icon: <HardDrive color={C.primary} size={19} />, screen: 'Folders' },
                        { label: 'Settings', icon: <Activity color={C.textBody} size={19} />, screen: 'Settings' },
                    ].map((item, i, arr) => (
                        <TouchableOpacity
                            key={i}
                            style={[s.menuRow, i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}
                            onPress={() => navigation.navigate(item.screen)}
                            activeOpacity={0.7}
                        >
                            <View style={[s.menuIconBox, { backgroundColor: C.background }]}>{item.icon}</View>
                            <Text style={[s.menuLabel, { color: C.textHeading }]}>{item.label}</Text>
                            <ChevronRight color={C.textBody} size={18} />
                        </TouchableOpacity>
                    ))}
                </View>

                {/* ── Activity Log ── */}
                <Text style={[s.sectionTitle, { color: C.textHeading }]}>Recent Activity</Text>
                <View style={[s.menuCard, { backgroundColor: C.card }]}>
                    {loading ? (
                        [1, 2, 3].map(i => (
                            <View key={i} style={[s.menuRow, { borderBottomWidth: 1, borderBottomColor: C.border }]}>
                                <SkeletonBlock width={36} height={36} borderRadius={10} />
                                <View style={{ marginLeft: 14, flex: 1 }}>
                                    <SkeletonBlock width="60%" height={13} borderRadius={5} style={{ marginBottom: 6 }} />
                                    <SkeletonBlock width="40%" height={11} borderRadius={5} />
                                </View>
                            </View>
                        ))
                    ) : activity.length === 0 ? (
                        <View style={s.emptyAct}>
                            <Activity color={C.textBody} size={32} />
                            <Text style={[s.emptyActTxt, { color: C.textBody }]}>No activity yet</Text>
                        </View>
                    ) : (
                        activity.map((act, i) => (
                            <View
                                key={act.id}
                                style={[s.menuRow, i < activity.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}
                            >
                                <View style={[s.actEmoji, { backgroundColor: C.background }]}>
                                    <Text style={{ fontSize: 17 }}>
                                        {ACTION_ICONS[act.action] || '📄'}
                                    </Text>
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[s.actTitle, { color: C.textHeading }]} numberOfLines={1}>
                                        {act.action.replace(/_/g, ' ')}{act.file_name ? `: "${act.file_name}"` : ''}
                                    </Text>
                                    <Text style={[s.actDate, { color: C.textBody }]}>{formatDate(act.created_at)}</Text>
                                </View>
                            </View>
                        ))
                    )}
                </View>

                {/* ── Sign Out Button ── */}
                <TouchableOpacity style={[s.signOutBtn, { backgroundColor: 'rgba(255, 78, 78, 0.1)' }]} onPress={handleLogout} activeOpacity={0.8}>
                    <LogOut color={C.danger} size={20} />
                    <Text style={[s.signOutTxt, { color: C.danger }]}>Sign Out</Text>
                </TouchableOpacity>

                <View style={{ height: 48 }} />
            </ScrollView>
        </SafeAreaView>
    );
}

const s = StyleSheet.create({
    root: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingTop: Platform.OS === 'web' ? 44 : 20, paddingBottom: 14,
    },
    backBtn: { width: 40, height: 40, justifyContent: 'center' },
    headerTitle: { fontSize: 18, fontWeight: '700' },
    logoutHeaderBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },

    content: { paddingHorizontal: 20 },

    heroCard: {
        borderRadius: 32, paddingVertical: 36, paddingHorizontal: 20,
        alignItems: 'center', marginBottom: 28, position: 'relative', overflow: 'hidden',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)',
        ...Platform.select({
            ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.3, shadowRadius: 20 },
            android: { elevation: 12 }
        })
    },
    cardBranding: {
        position: 'absolute', top: 20, left: 20,
        flexDirection: 'row', alignItems: 'center', gap: 6,
        backgroundColor: 'rgba(255,255,255,0.06)', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12
    },
    cardBrandText: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },

    avatarOuterRing: {
        width: 86, height: 86, borderRadius: 43,
        backgroundColor: 'transparent',
        justifyContent: 'center', alignItems: 'center',
        borderWidth: 2, borderColor: 'rgba(255, 255, 255, 0.1)',
        marginTop: 18,
    },
    avatarInnerCircle: {
        width: 74, height: 74, borderRadius: 37,
        backgroundColor: 'rgba(255,255,255,0.08)',
        justifyContent: 'center', alignItems: 'center',
    },
    profileName: {
        fontSize: 24, fontWeight: '800', color: '#fff', marginTop: 22, letterSpacing: -0.4,
    },
    profilePhone: { fontSize: 15, color: 'rgba(255,255,255,0.5)', marginTop: 6 },

    sectionTitle: {
        fontSize: 16, fontWeight: '700',
        marginBottom: 14, marginTop: 4,
    },

    statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 28 },
    statCard: {
        width: '47%', borderRadius: 20, padding: 18,
        alignItems: 'center',
        shadowColor: '#96A0B5', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
    },
    statIcon: {
        width: 44, height: 44, borderRadius: 13,
        justifyContent: 'center', alignItems: 'center', marginBottom: 10,
    },
    statVal: { fontSize: 22, fontWeight: '800', marginBottom: 4 },
    statLbl: { fontSize: 12, fontWeight: '600', textAlign: 'center' },

    menuCard: {
        borderRadius: 20, paddingHorizontal: 16,
        marginBottom: 28,
        shadowColor: '#96A0B5', shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.05, shadowRadius: 10, elevation: 2,
    },
    menuRow: {
        flexDirection: 'row', alignItems: 'center', paddingVertical: 15, gap: 14,
    },
    menuIconBox: {
        width: 38, height: 38, borderRadius: 10,
        justifyContent: 'center', alignItems: 'center',
    },
    menuLabel: { flex: 1, fontSize: 15, fontWeight: '600' },

    actEmoji: {
        width: 38, height: 38, borderRadius: 10,
        justifyContent: 'center', alignItems: 'center',
    },
    actTitle: {
        fontSize: 13, fontWeight: '600',
        textTransform: 'capitalize', marginBottom: 3,
    },
    actDate: { fontSize: 11 },

    emptyAct: { paddingVertical: 28, alignItems: 'center', gap: 10 },
    emptyActTxt: { fontSize: 14 },

    signOutBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 10, height: 54, borderRadius: 16, marginBottom: 8,
    },
    signOutTxt: { fontSize: 16, fontWeight: '700' },
});
