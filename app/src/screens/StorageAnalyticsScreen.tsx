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

    const TOTAL_QUOTA = 15 * 1024 * 1024 * 1024; // 15GB 
    
    // Core colors from prompt
    const Accent = '#FF5A1F'; // Apps/Images
    const Blue = '#3B82F6';   // Videos
    const Green = '#10B981';  // Music/Docs

    // Theme adaptations
    const BG_COLOR = isDark ? '#0A0A0A' : '#FFFFFF';
    const CARD_BG = isDark ? '#141414' : '#F5F7FB';
    const TEXT_MAIN = isDark ? '#FFFFFF' : '#1A1A1A';
    const TEXT_SUB = isDark ? '#A0A0A0' : '#6B7280';

    const getPercent = (val: number) => {
        if (!TOTAL_QUOTA) return 0;
        return (val / TOTAL_QUOTA);
    };

    const vTotal = stats.videoBytes;
    const iTotal = stats.imageBytes;
    const dTotal = stats.docBytes + stats.otherBytes;
    const usedBytes = vTotal + iTotal + dTotal;
    
    const vPct = getPercent(vTotal);
    const iPct = getPercent(iTotal);
    const dPct = getPercent(dTotal);
    const usedPct = getPercent(usedBytes) * 100;

    // Chart Dimensions
    const size = 280;
    const strokeWidth = 32;
    const center = size / 2;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;

    return (
        <SafeAreaView style={[st.root, { backgroundColor: BG_COLOR }]}>
            {/* 1. Header Section */}
            <View style={[st.header, { paddingTop: Math.max(insets.top + 8, 16) }]}>
                <TouchableOpacity style={st.headerBtn} onPress={() => navigation.goBack()}>
                    <ArrowLeft color={TEXT_MAIN} size={24} />
                </TouchableOpacity>
                <Text style={[st.headerTitle, { color: TEXT_MAIN }]}>My Storage</Text>
                <View style={{ width: 44 }} />
            </View>

            {loading ? (
                <View style={st.loaderView}>
                    <ActivityIndicator size="large" color={Accent} />
                </View>
            ) : (
                <Animated.ScrollView 
                    style={{ opacity: fadeAnim }} 
                    contentContainerStyle={st.scroll} 
                    showsVerticalScrollIndicator={false}
                >
                    {/* 2. Top Category Cards */}
                    <View style={st.topCardsRow}>
                        <View style={[st.topCard, { backgroundColor: CARD_BG }]}>
                            <View style={[st.topCardIcon, { backgroundColor: 'rgba(59, 130, 246, 0.1)' }]}>
                                <Video color={Blue} size={20} />
                            </View>
                            <Text style={[st.topCardPercent, { color: TEXT_MAIN }]}>
                                {(getPercent(vTotal) * 100).toFixed(0)}%
                            </Text>
                            <Text style={[st.topCardLabel, { color: TEXT_SUB }]}>Videos</Text>
                        </View>
                        
                        <View style={[st.topCard, { backgroundColor: CARD_BG }]}>
                            <View style={[st.topCardIcon, { backgroundColor: 'rgba(255, 90, 31, 0.1)' }]}>
                                <ImageIcon color={Accent} size={20} />
                            </View>
                            <Text style={[st.topCardPercent, { color: TEXT_MAIN }]}>
                                {(getPercent(iTotal) * 100).toFixed(0)}%
                            </Text>
                            <Text style={[st.topCardLabel, { color: TEXT_SUB }]}>Images</Text>
                        </View>

                        <View style={[st.topCard, { backgroundColor: CARD_BG }]}>
                            <View style={[st.topCardIcon, { backgroundColor: 'rgba(16, 185, 129, 0.1)' }]}>
                                <FileText color={Green} size={20} />
                            </View>
                            <Text style={[st.topCardPercent, { color: TEXT_MAIN }]}>
                                {(getPercent(dTotal) * 100).toFixed(0)}%
                            </Text>
                            <Text style={[st.topCardLabel, { color: TEXT_SUB }]}>Docs</Text>
                        </View>
                    </View>

                    {/* 3. Memory Status Card (MAIN COMPONENT) */}
                    <View style={[st.memoryCard, { backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF', 
                        borderColor: isDark ? '#2C2C2E' : '#E5E7EB', borderWidth: isDark ? 1 : 0,
                        shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: isDark ? 0 : 0.05, shadowRadius: 20
                    }]}>
                        <View style={st.memoryCardHeader}>
                            <Text style={[st.memoryCardTitle, { color: TEXT_MAIN }]}>Memory Status</Text>
                            <TouchableOpacity style={st.memoryCardArrow}>
                                <ChevronRight color={TEXT_SUB} size={20} />
                            </TouchableOpacity>
                        </View>

                        {/* 4. Circular Storage Visualization */}
                        <View style={st.chartContainer}>
                            <Svg width={size} height={size}>
                                {/* Background Empty Ring */}
                                <Circle 
                                    cx={center} cy={center} r={radius} 
                                    stroke={isDark ? '#2C2C2E' : '#F5F7FB'} 
                                    strokeWidth={strokeWidth} 
                                    fill="none" 
                                />

                                {/* Video G */}
                                {vPct > 0 && (
                                    <G rotation="-90" originX={center} originY={center}>
                                        <Circle 
                                            cx={center} cy={center} r={radius} 
                                            stroke={Blue} strokeWidth={strokeWidth} fill="none" 
                                            strokeDasharray={`${vPct * circumference} ${circumference}`} 
                                            strokeLinecap={Platform.OS === 'ios' ? "round" : "butt"} 
                                        />
                                    </G>
                                )}

                                {/* Images G */}
                                {iPct > 0 && (
                                    <G rotation={-90 + (vPct * 360)} originX={center} originY={center}>
                                        <Circle 
                                            cx={center} cy={center} r={radius} 
                                            stroke={Accent} strokeWidth={strokeWidth} fill="none" 
                                            strokeDasharray={`${iPct * circumference} ${circumference}`}
                                            strokeLinecap={Platform.OS === 'ios' ? "round" : "butt"} 
                                        />
                                    </G>
                                )}

                                {/* Docs G */}
                                {dPct > 0 && (
                                    <G rotation={-90 + ((vPct + iPct) * 360)} originX={center} originY={center}>
                                        <Circle 
                                            cx={center} cy={center} r={radius} 
                                            stroke={Green} strokeWidth={strokeWidth} fill="none" 
                                            strokeDasharray={`${dPct * circumference} ${circumference}`}
                                            strokeLinecap={Platform.OS === 'ios' ? "round" : "butt"} 
                                        />
                                    </G>
                                )}
                            </Svg>

                            {/* Center Content */}
                            <View style={st.chartCenterContent}>
                                <Text style={[st.chartCenterPercent, { color: TEXT_MAIN }]}>{usedPct.toFixed(0)}%</Text>
                                <Text style={[st.chartCenterText, { color: TEXT_SUB }]}>
                                    {formatBytes(usedBytes)} of {formatBytes(TOTAL_QUOTA)} used
                                </Text>
                            </View>

                            {/* 5. Labels Around Circle (Simplified Absolute Positioning) */}
                            {vPct > 0 && (
                                <View style={[st.floatingLabel, { top: 20, left: -10 }]}>
                                    <View style={[st.labelDotBox, { backgroundColor: isDark ? '#2C2C2E' : 'rgba(255,255,255,0.9)' }]}>
                                        <View style={[st.dot, { backgroundColor: Blue }]} /><Text style={[st.labelText, { color: TEXT_SUB }]}>Videos</Text>
                                    </View>
                                </View>
                            )}
                            
                            {iPct > 0 && (
                                <View style={[st.floatingLabel, { bottom: 10, right: 20 }]}>
                                    <View style={[st.labelDotBox, { backgroundColor: isDark ? '#2C2C2E' : 'rgba(255,255,255,0.9)' }]}>
                                        <View style={[st.dot, { backgroundColor: Accent }]} /><Text style={[st.labelText, { color: TEXT_SUB }]}>Images</Text>
                                    </View>
                                </View>
                            )}

                            {dPct > 0 && (
                                <View style={[st.floatingLabel, { top: 80, right: -20 }]}>
                                    <View style={[st.labelDotBox, { backgroundColor: isDark ? '#2C2C2E' : 'rgba(255,255,255,0.9)' }]}>
                                        <View style={[st.dot, { backgroundColor: Green }]} /><Text style={[st.labelText, { color: TEXT_SUB }]}>Docs</Text>
                                    </View>
                                </View>
                            )}
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
    
    topCardsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 24,
        gap: 12
    },
    topCard: {
        flex: 1,
        borderRadius: 20,
        padding: 16,
        alignItems: 'center',
    },
    topCardIcon: {
        width: 40, height: 40, borderRadius: 12,
        justifyContent: 'center', alignItems: 'center',
        marginBottom: 12,
    },
    topCardPercent: { fontSize: 18, fontWeight: '700', marginBottom: 2 },
    topCardLabel: { fontSize: 13, fontWeight: '500' },

    memoryCard: {
        borderRadius: 32,
        padding: 24, paddingVertical: 28,
        alignItems: 'center',
    },
    memoryCardHeader: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%',
        marginBottom: 40,
    },
    memoryCardTitle: { fontSize: 18, fontWeight: '700' },
    memoryCardArrow: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-end' },
    
    chartContainer: {
        position: 'relative',
        width: 280, height: 280,
        justifyContent: 'center', alignItems: 'center',
        marginBottom: 20,
    },
    chartCenterContent: {
        position: 'absolute',
        justifyContent: 'center', alignItems: 'center',
        width: 180, height: 180,
    },
    chartCenterPercent: { fontSize: 44, fontWeight: '800', letterSpacing: -1, marginBottom: 8 },
    chartCenterText: { fontSize: 13, textAlign: 'center', maxWidth: 120, lineHeight: 18 },

    floatingLabel: {
        position: 'absolute',
    },
    labelDotBox: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
        shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
    labelText: { fontSize: 12, fontWeight: '600' }
});
