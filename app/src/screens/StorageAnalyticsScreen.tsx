import React, { useState, useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView,
    TouchableOpacity, ActivityIndicator, Animated, Platform, ScrollView
} from 'react-native';
import { ArrowLeft, Video, Image as ImageIcon, FileText, ChevronRight } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import apiClient from '../services/apiClient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, G } from 'react-native-svg';
import { useFileRefresh } from '../utils/events';

export default function StorageAnalyticsScreen({ navigation }: any) {
    const { isDark } = useTheme();
    const insets = useSafeAreaInsets();
    
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>({
        totalBytes: 0,
        imageBytes: 0,
        videoBytes: 0,
        docBytes: 0,
        otherBytes: 0,
    });

    const fadeAnim = useRef(new Animated.Value(0)).current;
    const progressAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        fetchStats();
    }, []);

    useFileRefresh(() => {
        fetchStats();
    });

    const fetchStats = async () => {
        try {
            const res = await apiClient.get('/files/stats');
            if (res.data?.success) {
                const total = Number(res.data.totalBytes || res.data.total_size || 0);
                const imageBytes = Number(res.data.imageBytes || res.data.image_bytes || 0);
                const videoBytes = Number(res.data.videoBytes || res.data.video_bytes || 0);
                const docBytes = Number(res.data.docBytes || res.data.doc_bytes || 0);
                const payloadOther = Number(res.data.otherBytes || res.data.other_bytes || 0);
                const known = imageBytes + videoBytes + docBytes;
                const otherBytes = payloadOther > 0 ? payloadOther : Math.max(0, total - known);
                setStats({
                    totalBytes: total,
                    imageBytes,
                    videoBytes,
                    docBytes,
                    otherBytes,
                });
            }
        } catch {
            // keep zeros
        } finally {
            setLoading(false);
            Animated.parallel([
                Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
                Animated.timing(progressAnim, { toValue: 1, duration: 1200, useNativeDriver: false }), // false for SVG
            ]).start();
        }
    };

    const formatBytes = (bytes: number) => {
        if (!bytes) return '0 B';
        const k = 1024, s = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
    };

    const TOTAL_QUOTA = 15 * 1024 * 1024 * 1024; // Keeping reference but making donut relative
    
    // Core colors from prompt (slightly tuned for pure vibrancy)
    const Accent = '#F97316'; // Images
    const Blue = '#3B82F6';   // Videos
    const Green = '#10B981';  // Docs
    const Other = '#8B5CF6';  // Other (Purple)

    // Theme adaptations
    const BG_COLOR = isDark ? '#0A0A0A' : '#FFFFFF';
    const CARD_BG = isDark ? '#141414' : '#F5F7FB';
    const BORDER = isDark ? '#2C2C2E' : '#E5E7EB';
    const TEXT_MAIN = isDark ? '#FFFFFF' : '#1A1A1A';
    const TEXT_SUB = isDark ? '#A0A0A0' : '#6B7280';

    const vTotal = stats.videoBytes;
    const iTotal = stats.imageBytes;
    const dTotal = stats.docBytes;
    const oTotal = stats.otherBytes;
    const usedBytes = vTotal + iTotal + dTotal + oTotal;
    
    // Compute percentages relative to USED space, NOT quota! (Unlimited Drive)
    const getUsedPct = (val: number) => {
        if (usedBytes === 0) return 0;
        return (val / usedBytes);
    };

    const vPct = getUsedPct(vTotal);
    const iPct = getUsedPct(iTotal);
    const dPct = getUsedPct(dTotal);
    const oPct = getUsedPct(oTotal);



    return (
        <SafeAreaView style={[st.root, { backgroundColor: BG_COLOR }]}>
            {/* 1. Header Section */}
            <View style={[st.header, { paddingTop: Math.max(insets.top + 8, 16) }]}>
                <TouchableOpacity style={st.headerBtn} onPress={() => navigation.goBack()}>
                    <ArrowLeft color={TEXT_MAIN} size={24} />
                </TouchableOpacity>
                <Text style={[st.headerTitle, { color: TEXT_MAIN }]}>Storage Analytics</Text>
                <View style={{ width: 44 }} />
            </View>

            {loading ? (
                <View style={st.loaderView}>
                    <ActivityIndicator size="large" color={Blue} />
                </View>
            ) : (
                <Animated.ScrollView 
                    style={{ opacity: fadeAnim }} 
                    contentContainerStyle={st.scroll} 
                    showsVerticalScrollIndicator={false}
                >
                    {/* 3. Memory Status Card (MAIN COMPONENT) */}
                    <View style={[st.memoryCard, { backgroundColor: CARD_BG, borderColor: BORDER, borderWidth: StyleSheet.hairlineWidth }]}>
                        <View style={st.memoryCardHeader}>
                            <View>
                                <Text style={[st.memoryCardTitle, { color: TEXT_MAIN }]}>Storage Usage</Text>
                                <Text style={[st.memoryCardSub, { color: TEXT_SUB }]}>Total Used • Unlimited</Text>
                            </View>
                            <Text style={[st.memoryCardUsedBytes, { color: TEXT_MAIN }]}>{formatBytes(usedBytes)}</Text>
                        </View>

                        {/* 4. Horizontal Stacked Bar */}
                        <View style={[st.stackedBarTrack, { backgroundColor: isDark ? '#1F2937' : '#F1F5F9' }]}>
                            {usedBytes === 0 ? (
                                <View style={[st.stackedBarSegment, { backgroundColor: isDark ? '#2C2C2E' : '#E5E7EB', width: '100%' }]} />
                            ) : (
                                <>
                                    {vPct > 0 && <View style={[st.stackedBarSegment, { backgroundColor: Blue, width: `${vPct * 100}%` }]} />}
                                    {iPct > 0 && <View style={[st.stackedBarSegment, { backgroundColor: Accent, width: `${iPct * 100}%` }]} />}
                                    {dPct > 0 && <View style={[st.stackedBarSegment, { backgroundColor: Green, width: `${dPct * 100}%` }]} />}
                                    {oPct > 0 && <View style={[st.stackedBarSegment, { backgroundColor: Other, width: `${oPct * 100}%` }]} />}
                                </>
                            )}
                        </View>
                    </View>

                    {/* 2. Top Category Breakdown Rows */}
                    <Text style={[st.sectionLabel, { color: TEXT_SUB, marginTop: 28 }]}>BREAKDOWN BY CATEGORY</Text>
                    
                    <View style={[st.breakdownCard, { backgroundColor: CARD_BG, borderColor: BORDER, borderWidth: StyleSheet.hairlineWidth }]}>
                        
                        <View style={st.breakdownRow}>
                            <View style={st.breakdownIconWrap}>
                                <View style={[st.breakdownDot, { backgroundColor: Blue }]} />
                                <Text style={[st.breakdownText, { color: TEXT_MAIN }]}>Videos</Text>
                            </View>
                            <View style={st.breakdownRight}>
                                <Text style={[st.breakdownSize, { color: TEXT_MAIN }]}>{formatBytes(vTotal)}</Text>
                                <Text style={[st.breakdownPct, { color: TEXT_SUB }]}>{(vPct * 100).toFixed(1)}%</Text>
                            </View>
                        </View>
                        <View style={[st.breakdownDivider, { backgroundColor: BORDER }]} />
                        
                        <View style={st.breakdownRow}>
                            <View style={st.breakdownIconWrap}>
                                <View style={[st.breakdownDot, { backgroundColor: Accent }]} />
                                <Text style={[st.breakdownText, { color: TEXT_MAIN }]}>Images</Text>
                            </View>
                            <View style={st.breakdownRight}>
                                <Text style={[st.breakdownSize, { color: TEXT_MAIN }]}>{formatBytes(iTotal)}</Text>
                                <Text style={[st.breakdownPct, { color: TEXT_SUB }]}>{(iPct * 100).toFixed(1)}%</Text>
                            </View>
                        </View>
                        <View style={[st.breakdownDivider, { backgroundColor: BORDER }]} />
                        
                        <View style={st.breakdownRow}>
                            <View style={st.breakdownIconWrap}>
                                <View style={[st.breakdownDot, { backgroundColor: Green }]} />
                                <Text style={[st.breakdownText, { color: TEXT_MAIN }]}>Documents</Text>
                            </View>
                            <View style={st.breakdownRight}>
                                <Text style={[st.breakdownSize, { color: TEXT_MAIN }]}>{formatBytes(dTotal)}</Text>
                                <Text style={[st.breakdownPct, { color: TEXT_SUB }]}>{(dPct * 100).toFixed(1)}%</Text>
                            </View>
                        </View>
                        <View style={[st.breakdownDivider, { backgroundColor: BORDER }]} />
                        
                        <View style={st.breakdownRow}>
                            <View style={st.breakdownIconWrap}>
                                <View style={[st.breakdownDot, { backgroundColor: Other }]} />
                                <Text style={[st.breakdownText, { color: TEXT_MAIN }]}>Other</Text>
                            </View>
                            <View style={st.breakdownRight}>
                                <Text style={[st.breakdownSize, { color: TEXT_MAIN }]}>{formatBytes(oTotal)}</Text>
                                <Text style={[st.breakdownPct, { color: TEXT_SUB }]}>{(oPct * 100).toFixed(1)}%</Text>
                            </View>
                        </View>

                    </View>
                    
                    <View style={{ height: 60 }} />
                </Animated.ScrollView>
            )}
        </SafeAreaView>
    );
}

const st = StyleSheet.create({
    root: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingBottom: 16, zIndex: 10,
    },
    headerBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start' },
    headerTitle: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
    loaderView: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    scroll: { paddingHorizontal: 20, paddingBottom: 24, paddingTop: 12 },

    memoryCard: {
        borderRadius: 28,
        padding: 24, paddingVertical: 28,
        alignItems: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.05, shadowRadius: 20, elevation: 4,
    },
    memoryCardHeader: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%',
        marginBottom: 30,
    },
    memoryCardTitle: { fontSize: 18, fontWeight: '700' },
    memoryCardSub: { fontSize: 13, marginTop: 4, fontWeight: '500' },
    memoryCardUsedBytes: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },

    stackedBarTrack: {
        height: 12,
        borderRadius: 6,
        flexDirection: 'row',
        overflow: 'hidden',
        width: '100%',
        marginTop: 4,
    },
    stackedBarSegment: {
        height: '100%',
    },

    sectionLabel: {
        fontSize: 12, fontWeight: '700', letterSpacing: 1.2,
        marginBottom: 12, paddingLeft: 6,
    },
    breakdownCard: {
        borderRadius: 24,
        overflow: 'hidden',
        shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.04, shadowRadius: 16, elevation: 3,
    },
    breakdownRow: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingVertical: 18, paddingHorizontal: 20,
    },
    breakdownIconWrap: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    breakdownDot: { width: 12, height: 12, borderRadius: 6 },
    breakdownText: { fontSize: 16, fontWeight: '600' },
    breakdownRight: { alignItems: 'flex-end' },
    breakdownSize: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
    breakdownPct: { fontSize: 13, fontWeight: '500' },
    breakdownDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 20 },
});
