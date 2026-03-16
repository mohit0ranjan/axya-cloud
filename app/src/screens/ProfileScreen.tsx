import React, { useState, useEffect, useContext, useRef, useCallback } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView,
    TouchableOpacity, Alert, Platform, Animated, Pressable, Switch,
} from 'react-native';
import {
    ArrowLeft, Trash2,
    Settings, Edit2, Sparkles, UploadCloud, Moon
} from 'lucide-react-native';
import { AuthContext } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useTheme } from '../context/ThemeContext';
import apiClient from '../services/apiClient';
import { SkeletonBlock } from '../ui/Skeleton';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ProfileScreen({ navigation }: any) {
    const authCtx = useContext(AuthContext);
    const { showToast } = useToast();
    const { theme, isDark, toggleTheme } = useTheme();
    const insets = useSafeAreaInsets();

    const [loading, setLoading] = useState(true);
    const [isSigningOut, setIsSigningOut] = useState(false);
    const [stats, setStats] = useState<any>({});
    
    // Preferences state
    const [uploadNotifs, setUploadNotifs] = useState(true);
    
    const appVersion = Constants.expoConfig?.version || '1.0.0';

    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(20)).current;

    useEffect(() => {
        fetchAll();
        Animated.parallel([
            Animated.timing(fadeAnim, { toValue: 1, duration: 420, useNativeDriver: true }),
            Animated.timing(slideAnim, { toValue: 0, duration: 420, useNativeDriver: true }),
        ]).start();
    }, []);

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

    const formatStorageSplit = (bytes: number): { value: string; unit: string } => {
        if (!bytes) return { value: '0', unit: 'B' };
        const mb = bytes / (1024 * 1024);
        if (mb >= 1024) {
            const gb = mb / 1024;
            return { value: gb >= 10 ? Math.round(gb).toString() : gb.toFixed(2), unit: 'GB' };
        }
        return { value: Math.round(mb).toString(), unit: 'MB' };
    };

    const userName = authCtx.user?.name || authCtx.user?.username || 'Axya User';
    const userPhone = authCtx.user?.phone || '';
    const avatarLetter = (userName[0] || '?').toUpperCase();

    const storage = loading ? { value: '-', unit: '' } : formatStorageSplit(stats.totalBytes || 0);

    const handleBack = () => {
        if (navigation?.canGoBack?.()) {
            navigation.goBack();
            return;
        }
        navigation?.navigate?.('MainTabs', { screen: 'Home' });
    };

    // Premium minimal styling values
    const BG_COLOR = isDark ? '#0A0A0F' : '#F9FBFF';
    const CARD_BG = isDark ? '#14141E' : '#FFFFFF';
    const TEXT_MAIN = isDark ? '#FFFFFF' : '#0F172A';
    const TEXT_SUB = isDark ? '#94A3B8' : '#64748B';
    const BORDER_COLOR = isDark ? '#1F1F2E' : '#E2E8F0';

    return (
        <SafeAreaView style={[st.root, { backgroundColor: BG_COLOR }]}>
            {/* STICKY HEADER */}
            <View style={[st.header, { backgroundColor: BG_COLOR, paddingTop: Math.max(insets.top + 8, 16) }]}>
                <TouchableOpacity style={st.headerBtn} onPress={handleBack} activeOpacity={0.7}>
                    <ArrowLeft color={TEXT_MAIN} size={24} strokeWidth={2.5} />
                </TouchableOpacity>
                <TouchableOpacity style={st.headerBtnRight} onPress={() => navigation.navigate('Settings')} activeOpacity={0.7}>
                    <Sparkles color="#4B6EF5" size={24} strokeWidth={2} />
                </TouchableOpacity>
            </View>

            <Animated.ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={st.scroll}
                style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
            >
                {/* PROFILE SECTION */}
                <View style={st.profileCenterCol}>
                    <View style={st.avatarWrap}>
                        <View style={st.avatarCircle}>
                            <Text style={st.avatarLetter}>{avatarLetter}</Text>
                        </View>
                        <TouchableOpacity style={st.editIconBadge} activeOpacity={0.8}>
                            <Edit2 color="#FFF" size={14} strokeWidth={2.5} />
                        </TouchableOpacity>
                    </View>

                    {loading ? (
                        <View style={{ alignItems: 'center', marginTop: 12 }}>
                            <SkeletonBlock width={140} height={20} borderRadius={8} />
                            <SkeletonBlock width={100} height={14} borderRadius={6} style={{ marginTop: 8 }} />
                        </View>
                    ) : (
                        <View style={st.profileInfoCol}>
                            <Text style={[st.userNameText, { color: TEXT_MAIN }]}>{userName}</Text>
                            <View style={st.phoneProRow}>
                                <Text style={[st.userPhoneText, { color: TEXT_SUB }]}>{userPhone || '+91XXXXXXXXXX'}</Text>
                                <View style={st.proBadge}>
                                    <Text style={st.proBadgeText}>PRO</Text>
                                </View>
                            </View>
                            
                            <View style={st.syncBadge}>
                                <View style={st.syncDot} />
                                <Text style={st.syncBadgeText}>Telegram Cloud Sync Enabled</Text>
                            </View>
                        </View>
                    )}
                </View>

                {/* PREMIUM STORAGE CARD */}
                <View style={[st.storageCard, { backgroundColor: CARD_BG, borderColor: BORDER_COLOR }]}>
                    <Text style={[st.storageCardTitle, { color: TEXT_MAIN }]}>Cloud Storage</Text>
                    <Text style={[st.storageCardUsage, { color: TEXT_SUB }]}>
                         {storage.value} {storage.unit} used · Unlimited Storage
                    </Text>

                    {/* STORAGE ACTION MINI CARDS */}
                    <View style={st.actionCardsGrid}>
                        <TouchableOpacity 
                            style={[st.actionCardSmall, { backgroundColor: isDark ? '#1C1C2A' : '#FAFAFA', borderColor: BORDER_COLOR }]} 
                            onPress={() => navigation.navigate('Settings')}
                            activeOpacity={0.7}
                        >
                            <View style={[st.actionIconBox, { backgroundColor: isDark ? 'rgba(75,110,245,0.1)' : '#EEF2FF' }]}>
                                <Settings color="#4B6EF5" size={20} />
                            </View>
                            <View>
                                <Text style={[st.actionCardTitle, { color: TEXT_MAIN }]}>Preferences</Text>
                                <Text style={[st.actionCardSub, { color: TEXT_SUB }]}>Manage app settings</Text>
                            </View>
                        </TouchableOpacity>
                        
                        <TouchableOpacity 
                            style={[st.actionCardSmall, { backgroundColor: isDark ? '#1C1C2A' : '#FAFAFA', borderColor: BORDER_COLOR }]} 
                            onPress={() => navigation.navigate('Trash')}
                            activeOpacity={0.7}
                        >
                            <View style={[st.actionIconBox, { backgroundColor: isDark ? 'rgba(16,185,129,0.1)' : '#F0FDF4' }]}>
                                <Trash2 color="#10B981" size={20} />
                            </View>
                            <View>
                                <Text style={[st.actionCardTitle, { color: TEXT_MAIN }]}>Trash</Text>
                                <Text style={[st.actionCardSub, { color: TEXT_SUB }]}>Restore or delete files</Text>
                            </View>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* PREFERENCES SECTION */}
                <View style={[st.listCard, { backgroundColor: CARD_BG, borderColor: BORDER_COLOR }]}>
                    <View style={st.settingRow}>
                        <View style={[st.settingIconContainer, { backgroundColor: isDark ? '#1C1C2A' : '#F8FAFC' }]}>
                            <UploadCloud color={TEXT_MAIN} size={20} />
                        </View>
                        <Text style={[st.settingLabel, { color: TEXT_MAIN }]}>Upload Notifications</Text>
                        <Switch 
                            value={uploadNotifs} 
                            onValueChange={setUploadNotifs} 
                            trackColor={{ false: isDark ? '#333' : '#E2E8F0', true: '#4B6EF5' }} 
                            thumbColor="#FFF"
                        />
                    </View>
                    
                    <View style={[st.divider, { backgroundColor: BORDER_COLOR }]} />
                    
                    <View style={[st.settingRow, { paddingBottom: 16 }]}>
                        <View style={[st.settingIconContainer, { backgroundColor: isDark ? '#1C1C2A' : '#F8FAFC' }]}>
                            <Moon color={TEXT_MAIN} size={20} />
                        </View>
                        <Text style={[st.settingLabel, { color: TEXT_MAIN }]}>Dark Mode</Text>
                        <Switch 
                            value={isDark} 
                            onValueChange={toggleTheme} 
                            trackColor={{ false: isDark ? '#333' : '#E2E8F0', true: '#4B6EF5' }} 
                            thumbColor="#FFF"
                        />
                    </View>
                </View>



                {/* LOGOUT BUTTON */}
                <TouchableOpacity
                    onPress={handleLogout}
                    activeOpacity={0.85}
                    disabled={isSigningOut}
                    style={[
                        st.logoutBtn,
                        { opacity: isSigningOut ? 0.65 : 1 },
                    ]}
                >
                    <Text style={st.logoutText}>
                        {isSigningOut ? 'Signing out...' : 'Sign Out'}
                    </Text>
                </TouchableOpacity>

                <View style={{height: 60}} />
            </Animated.ScrollView>
        </SafeAreaView>
    );
}

const st = StyleSheet.create({
    root: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingBottom: 8,
        zIndex: 10,
    },
    headerBtn: {
        width: 44,
        height: 44,
        justifyContent: 'center',
        alignItems: 'flex-start',
    },
    headerBtnRight: {
        width: 44,
        height: 44,
        justifyContent: 'center',
        alignItems: 'flex-end',
    },
    scroll: {
        paddingHorizontal: 20,
        paddingTop: 8,
        paddingBottom: 24,
    },

    /* Profile Header */
    profileCenterCol: {
        alignItems: 'center',
        marginBottom: 32,
    },
    avatarWrap: {
        position: 'relative',
        marginBottom: 16,
    },
    avatarCircle: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: '#4B6EF5',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#4B6EF5',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.2,
        shadowRadius: 16,
        elevation: 6,
    },
    avatarLetter: {
        color: '#FFF',
        fontSize: 38,
        fontWeight: '700',
    },
    editIconBadge: {
        position: 'absolute',
        bottom: 0,
        right: 0,
        backgroundColor: '#111827',
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: '#FFF',
    },
    profileInfoCol: {
        alignItems: 'center',
    },
    userNameText: {
        fontSize: 24,
        fontWeight: '700',
        letterSpacing: -0.5,
        marginBottom: 4,
    },
    phoneProRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginBottom: 16,
    },
    userPhoneText: {
        fontSize: 15,
        fontWeight: '500',
    },
    proBadge: {
        backgroundColor: '#EEF2FF',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
    },
    proBadgeText: {
        color: '#4B6EF5',
        fontSize: 10,
        fontWeight: '800',
        letterSpacing: 0.5,
    },
    syncBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        gap: 6,
    },
    syncDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#10B981',
    },
    syncBadgeText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#10B981',
    },

    /* Premium Storage Card */
    storageCard: {
        borderRadius: 24,
        padding: 20,
        marginBottom: 24,
        borderWidth: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.03,
        shadowRadius: 12,
        elevation: 2,
    },
    storageCardTitle: {
        fontSize: 18,
        fontWeight: '700',
        marginBottom: 4,
        letterSpacing: -0.3,
    },
    storageCardUsage: {
        fontSize: 14,
        marginBottom: 20,
        fontWeight: '500',
    },


    actionCardsGrid: {
        flexDirection: 'column',
        gap: 12,
    },
    actionCardSmall: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        gap: 14,
    },
    actionIconBox: {
        width: 44,
        height: 44,
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    actionCardTitle: {
        fontSize: 15,
        fontWeight: '600',
        marginBottom: 2,
    },
    actionCardSub: {
        fontSize: 13,
    },

    /* Settings & Trash Cards */
    listCard: {
        borderRadius: 24,
        borderWidth: 1,
        marginBottom: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.02,
        shadowRadius: 8,
        elevation: 1,
    },
    settingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 16,
        paddingHorizontal: 20,
    },
    settingIconContainer: {
        width: 36,
        height: 36,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 14,
    },
    settingLabel: {
        flex: 1,
        fontSize: 16,
        fontWeight: '500',
    },
    divider: {
        height: 1,
        marginLeft: 70,
        marginRight: 20,
    },

    /* Logout */
    logoutBtn: {
        height: 56,
        borderRadius: 24,
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: 8,
    },
    logoutText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#EF4444',
    },
});
