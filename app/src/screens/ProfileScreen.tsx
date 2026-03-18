import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView,
    TouchableOpacity, Alert, Animated, Switch, Platform, Pressable
} from 'react-native';
import {
    ArrowLeft, Trash2, Edit2, LogOut, BarChart2, Link as LinkIcon, ChevronRight, Moon, Bell
} from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import apiClient from '../services/apiClient';
import { SkeletonBlock } from '../ui/Skeleton';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFileRefresh } from '../utils/events';
import { getNotificationsEnabled, setNotificationsEnabled as persistNotificationsEnabled } from '../utils/preferences';

export default function ProfileScreen({ navigation }: any) {
    const authCtx = useContext(AuthContext);
    const { showToast } = useToast();
    const { theme, isDark, setThemeMode } = useTheme();
    const insets = useSafeAreaInsets();

    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>({});
    const [isSigningOut, setIsSigningOut] = useState(false);
    
    // Moved settings
    const [notificationsEnabled, setNotificationsEnabled] = useState(true);

    const appVersion = Constants.expoConfig?.version || '1.0.0';

    const fadeAnim = useRef(new Animated.Value(0)).current;
    const storageFillAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        fetchAll();
        getNotificationsEnabled().then(setNotificationsEnabled).catch(() => setNotificationsEnabled(true));
        Animated.parallel([
            Animated.timing(fadeAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
            Animated.timing(storageFillAnim, { toValue: 1, duration: 850, useNativeDriver: true }),
        ]).start();
    }, []);

    useFileRefresh(() => {
        fetchAll();
    });

    const fetchAll = async () => {
        setLoading(true);
        try {
            const statsRes = await apiClient.get('/files/stats').catch(() => ({ data: { success: false } }));
            if (statsRes.data?.success) setStats(statsRes.data);
        } catch {
            // silent fail
        } finally {
            setLoading(false);
        }
    };

    const toggleNotifications = (val: boolean) => {
        setNotificationsEnabled(val);
        persistNotificationsEnabled(val)
            .then(() => showToast(val ? 'Notifications enabled' : 'Notifications disabled', 'info'))
            .catch(() => showToast('Could not update notifications', 'error'));
    };

    const handleThemeToggle = useCallback((value: boolean) => {
        void setThemeMode(value ? 'dark' : 'light')
            .then(() => showToast(value ? 'Dark mode enabled' : 'Light mode enabled', 'info'))
            .catch(() => showToast('Could not update theme', 'error'));
    }, [setThemeMode, showToast]);

    const confirmLogout = useCallback(async () => {
        if (isSigningOut) return;
        setIsSigningOut(true);
        try {
            await authCtx?.logout?.();
        } catch {
            showToast('Sign out failed', 'error');
        } finally {
            setIsSigningOut(false);
        }
    }, [authCtx, isSigningOut, showToast]);

    const handleLogout = useCallback(() => {
        Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign Out', style: 'destructive', onPress: () => { void confirmLogout(); } },
        ]);
    }, [confirmLogout]);

    const formatBytes = (bytes: number) => {
        if (!bytes) return '0 B';
        const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + s[i];
    };

    const userName = authCtx.user?.name || authCtx.user?.username || 'Axya User';
    const userPhone = authCtx.user?.phone || '';
    const avatarLetter = (userName[0] || '?').toUpperCase();
    const usedBytes = Number(stats.totalBytes || stats.total_size || 0);
    const quotaBytes = Number(stats.totalQuotaBytes || stats.quotaBytes || stats.total_quota || 0);
    const hasQuota = quotaBytes > 0;
    const storageUsed = formatBytes(usedBytes);
    const usedGBNum = usedBytes / (1024 ** 3);
    const storageProgress = hasQuota
        ? Math.max(0, Math.min(usedBytes / quotaBytes, 1))
        : Math.max(0.02, Math.min(0.92, 0.12 + Math.log10(usedGBNum + 1) * 0.3));

    const handleBack = () => {
        if (navigation?.canGoBack?.()) navigation.goBack();
        else navigation?.navigate?.('MainTabs', { screen: 'Home' });
    };

    // Design System Values
    const BG_COLOR = theme.colors.background;
    const CARD_BG = theme.colors.card;
    const BORDER = theme.colors.border;
    const TEXT_MAIN = theme.colors.textHeading;
    const TEXT_SUB = theme.colors.textBody;
    const ACCENT = theme.colors.accent;
    const BLUE = theme.colors.primary;
    const SURFACE_MUTED = theme.colors.surfaceMuted;
    const SWITCH_TRACK_OFF = theme.colors.switchTrackOff;

    const renderMenuItem = (
        icon: React.ReactNode, 
        iconBg: string, 
        title: string, 
        onPress?: () => void, 
        RightElement?: React.ReactNode,
        isLast: boolean = false
    ) => (
        <Pressable
            style={({ pressed }) => [
                st.menuRow,
                {
                    borderBottomColor: BORDER,
                    borderBottomWidth: isLast ? 0 : 1,
                    backgroundColor: pressed ? (isDark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.10)') : 'transparent',
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                },
            ]}
            onPress={onPress}
        >
            <View style={[st.actionIconBox, { backgroundColor: iconBg }]}>
                {icon}
            </View>
            <View style={st.menuRowContent}>
                <Text style={[st.actionCardTitle, { color: TEXT_MAIN }]}>{title}</Text>
            </View>
            {RightElement || <ChevronRight color={TEXT_SUB} size={17} />}
        </Pressable>
    );

    return (
        <SafeAreaView style={[st.root, { backgroundColor: BG_COLOR }]}>
            {/* Header */}
            <View style={[st.header, { paddingTop: Math.max(insets.top + 8, 16) }]}>
                <TouchableOpacity style={st.headerBtn} onPress={handleBack} activeOpacity={0.7}>
                    <ArrowLeft color={TEXT_MAIN} size={24} strokeWidth={2.5} />
                </TouchableOpacity>
                <Text style={[st.headerTitle, { color: TEXT_MAIN }]}>Profile</Text>
                <View style={{ width: 44 }} />
            </View>

            <Animated.ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={st.scroll}
                style={{ opacity: fadeAnim }}
            >
                {/* 1. PROFILE OVERVIEW */}
                <View style={st.profileCenterCol}>
                    <View style={st.avatarWrap}>
                        <LinearGradient
                            colors={isDark ? ['#FB923C', '#F97316'] : ['#FF8A5B', '#FF5A1F']}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={st.avatarCircle}
                        >
                            <Text style={st.avatarLetter}>{avatarLetter}</Text>
                        </LinearGradient>
                    </View>

                    {loading ? (
                        <View style={{ alignItems: 'center', marginTop: 12 }}>
                            <SkeletonBlock width={140} height={20} borderRadius={8} />
                            <SkeletonBlock width={100} height={14} borderRadius={6} style={{ marginTop: 8 }} />
                        </View>
                    ) : (
                        <View style={st.profileInfoCol}>
                            <Text style={[st.userNameText, { color: TEXT_MAIN }]}>{userName}</Text>
                            <Text style={[st.userPhoneText, { color: TEXT_SUB }]}>{userPhone || 'No phone linked'}</Text>
                        </View>
                    )}
                </View>

                {/* 2. CLOUD STORAGE PREVIEW */}
                <Text style={[st.sectionLabel, { color: TEXT_SUB }]}>STORAGE</Text>
                <View style={[
                    st.card,
                    {
                        backgroundColor: CARD_BG,
                        borderColor: BORDER,
                        shadowColor: isDark ? '#020617' : '#0F172A',
                    },
                ]}>
                    <Pressable
                        style={({ pressed }) => [
                            st.storageFlexRow,
                            { transform: [{ scale: pressed ? 0.97 : 1 }] },
                        ]}
                        onPress={() => navigation.navigate('Analytics')}
                    >
                        <View style={[st.storageIconBlock, { backgroundColor: 'rgba(59, 130, 246, 0.1)' }]}>
                            <BarChart2 color={BLUE} size={22} />
                        </View>
                        <View style={{ flex: 1, paddingLeft: 12 }}>
                            <Text style={[st.storageLabel, { color: TEXT_MAIN }]}>Drive Analytics</Text>
                            <Text style={[st.storageSub, { color: TEXT_SUB }]}>
                                {loading
                                    ? 'Checking...'
                                    : hasQuota
                                        ? `${storageUsed} used of ${formatBytes(quotaBytes)}`
                                        : `${storageUsed} used • Unlimited`}
                            </Text>
                        </View>
                        <ChevronRight color={TEXT_SUB} size={18} style={{ opacity: 0.65 }} />
                    </Pressable>
                    <View style={[st.progressTrack, { backgroundColor: SURFACE_MUTED }]}> 
                        {loading ? (
                            <SkeletonBlock width="100%" height={6} borderRadius={6} />
                        ) : (
                            <Animated.View
                                style={{
                                    width: `${Math.max(storageProgress * 100, 2)}%`,
                                    transform: [{ scaleX: storageFillAnim }],
                                }}
                            >
                                <LinearGradient
                                    colors={['#60A5FA', '#3B82F6']}
                                    start={{ x: 0, y: 0.5 }}
                                    end={{ x: 1, y: 0.5 }}
                                    style={st.progressFill}
                                />
                            </Animated.View>
                        )}
                    </View>
                </View>

                {/* 3. PREFERENCES & SETTINGS */}
                <Text style={[st.sectionLabel, { color: TEXT_SUB }]}>PREFERENCES</Text>
                <View style={[
                    st.card,
                    {
                        backgroundColor: CARD_BG,
                        borderColor: BORDER,
                        shadowColor: isDark ? '#020617' : '#0F172A',
                    },
                ]}>
                    {renderMenuItem(
                        <Bell color={theme.colors.accent} size={20} />, 
                        theme.colors.warningSoft,
                        "Upload Notifications",
                        () => toggleNotifications(!notificationsEnabled),
                        <Switch
                            value={notificationsEnabled}
                            onValueChange={toggleNotifications}
                            trackColor={{ true: theme.colors.accent, false: SWITCH_TRACK_OFF }}
                            thumbColor="#FFFFFF"
                            ios_backgroundColor={SWITCH_TRACK_OFF}
                        />
                    )}
                    {renderMenuItem(
                        <Moon color={theme.colors.purple} size={20} />, 
                        theme.colors.infoSoft,
                        "Dark Mode",
                        () => handleThemeToggle(!isDark),
                        <Switch
                            value={isDark}
                            onValueChange={handleThemeToggle}
                            trackColor={{ true: theme.colors.purple, false: SWITCH_TRACK_OFF }}
                            thumbColor="#FFFFFF"
                            ios_backgroundColor={SWITCH_TRACK_OFF}
                        />,
                        true // last item
                    )}
                </View>

                {/* 4. UTILITIES */}
                <Text style={[st.sectionLabel, { color: TEXT_SUB }]}>UTILITIES</Text>
                <View style={[
                    st.card,
                    {
                        backgroundColor: CARD_BG,
                        borderColor: BORDER,
                        shadowColor: isDark ? '#020617' : '#0F172A',
                    },
                ]}>
                    {renderMenuItem(
                        <LinkIcon color="#10B981" size={20} />, 
                        theme.colors.successSoft,
                        "Shared Links",
                        () => navigation.navigate('SharedLinks'),
                    )}
                    {renderMenuItem(
                        <Trash2 color="#EF4444" size={20} />, 
                        theme.colors.dangerSoft,
                        "Trash",
                        () => navigation.navigate('Trash'),
                        undefined,
                        true
                    )}
                </View>

                {/* 5. LOGOUT */}
                <Pressable
                    onPress={handleLogout}
                    disabled={isSigningOut}
                    style={({ pressed }) => [
                        st.logoutBtn,
                        {
                            borderColor: isDark ? '#7F1D1D' : '#FECACA',
                            backgroundColor: isDark ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.08)',
                            transform: [{ scale: pressed ? 0.98 : 1 }],
                        },
                    ]}
                >
                    <LogOut color="#EF4444" size={20} strokeWidth={2.5} />
                    <Text style={st.logoutBtnText}>
                        {isSigningOut ? 'Signing out...' : 'Sign Out'}
                    </Text>
                </Pressable>

                <View style={st.versionRow}>
                    <Text style={[st.versionText, { color: TEXT_SUB }]}>Axya v{appVersion}</Text>
                </View>

                <View style={{height: 60}} />
            </Animated.ScrollView>
        </SafeAreaView>
    );
}

const st = StyleSheet.create({
    root: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 16,
    },
    headerBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start' },
    headerTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
    
    scroll: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 },

    /* Profile Center */
    profileCenterCol: { alignItems: 'center', marginBottom: 40 },
    avatarWrap: { position: 'relative', marginBottom: 14 },
    avatarCircle: {
        width: 116, height: 116, borderRadius: 58,
        justifyContent: 'center', alignItems: 'center',
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.18,
        shadowRadius: 16,
        elevation: 6,
    },
    avatarLetter: { color: '#FFF', fontSize: 40, fontWeight: '700' },
    editIconBadge: {
        position: 'absolute', bottom: 2, right: 2,
        width: 30, height: 30, borderRadius: 15,
        justifyContent: 'center', alignItems: 'center',
        borderWidth: 2,
        shadowColor: '#0F172A',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 6,
        elevation: 2,
    },
    profileInfoCol: { alignItems: 'center' },
    userNameText: { fontSize: 22, fontWeight: '600', marginBottom: 4, letterSpacing: 0.2 },
    userPhoneText: { fontSize: 14, fontWeight: '500', opacity: 0.85 },

    /* Sections */
    sectionLabel: {
        fontSize: 12, fontWeight: '700', letterSpacing: 1.2,
        marginBottom: 10, paddingLeft: 6,
    },
    card: {
        borderRadius: 18,
        borderWidth: StyleSheet.hairlineWidth,
        marginBottom: 28,
        overflow: 'hidden',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.08,
        shadowRadius: 14,
        elevation: 3,
    },
    
    /* Storage Row */
    storageFlexRow: {
        flexDirection: 'row', alignItems: 'center',
        padding: 20,
    },
    storageIconBlock: {
        width: 44, height: 44, borderRadius: 12,
        justifyContent: 'center', alignItems: 'center'
    },
    storageLabel: { fontSize: 16, fontWeight: '600', marginBottom: 2, letterSpacing: 0.2 },
    storageSub: { fontSize: 13, fontWeight: '500' },
    progressTrack: {
        height: 6,
        borderRadius: 6,
        marginHorizontal: 20,
        marginBottom: 18,
        overflow: 'hidden',
    },
    progressFill: { height: 6, borderRadius: 6 },

    /* Menu Items */
    menuRow: {
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 16, paddingHorizontal: 20,
    },
    actionIconBox: {
        width: 38, height: 38, borderRadius: 10,
        justifyContent: 'center', alignItems: 'center',
        marginRight: 12,
        opacity: 0.92,
    },
    menuRowContent: { flex: 1 },
    actionCardTitle: { fontSize: 16, fontWeight: '500' },

    /* Logout */
    logoutBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        paddingVertical: 16, borderRadius: 18, borderWidth: 1,
        marginTop: 12, gap: 10,
    },
    logoutBtnText: {
        color: '#EF4444', fontSize: 16, fontWeight: '600'
    },

    versionRow: { alignItems: 'center', marginTop: 24 },
    versionText: { fontSize: 13, fontWeight: '500' },
});
