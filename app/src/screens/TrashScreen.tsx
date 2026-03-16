import React, { useState, useEffect } from 'react';
import {
    View, Text, StyleSheet, SafeAreaView,
    TouchableOpacity, ActivityIndicator, Animated
} from 'react-native';
import { ArrowLeft, Trash2, AlertTriangle } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TrashScreen({ navigation }: any) {
    const { theme, isDark } = useTheme();
    const insets = useSafeAreaInsets();
    
    // For now, this is a placeholder screen as we don't have a specific trash endpoint yet
    // This allows the route to exist and be functional without breaking the app
    const [loading] = useState(false);
    
    const fadeAnim = new Animated.Value(0);

    useEffect(() => {
        Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }, []);

    const BG_COLOR = isDark ? '#0A0A0F' : '#F9FBFF';
    const CARD_BG = isDark ? '#14141E' : '#FFFFFF';
    const TEXT_MAIN = isDark ? '#FFFFFF' : '#0F172A';
    const TEXT_SUB = isDark ? '#94A3B8' : '#64748B';
    const BORDER = isDark ? '#1F1F2E' : '#E2E8F0';

    return (
        <SafeAreaView style={[st.root, { backgroundColor: BG_COLOR }]}>
            <View style={[st.header, { backgroundColor: BG_COLOR, paddingTop: Math.max(insets.top + 8, 16) }]}>
                <TouchableOpacity style={st.headerBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
                    <ArrowLeft color={TEXT_MAIN} size={24} strokeWidth={2.5} />
                </TouchableOpacity>
                <Text style={[st.headerTitle, { color: TEXT_MAIN }]}>Trash</Text>
                <TouchableOpacity style={[st.headerBtn, { alignItems: 'flex-end', width: 80 }]} activeOpacity={0.7}>
                    <Text style={{color: TEXT_SUB, fontWeight: '600'}}>Empty</Text>
                </TouchableOpacity>
            </View>

            {loading ? (
                <View style={st.loaderView}>
                    <ActivityIndicator size="large" color="#4B6EF5" />
                </View>
            ) : (
                <Animated.ScrollView contentContainerStyle={st.scroll} style={{ opacity: fadeAnim }} showsVerticalScrollIndicator={false}>
                    
                    <View style={[st.infoCard, { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.1)' : '#FFFBEB', borderColor: isDark ? '#451A03' : '#FEF3C7' }]}>
                        <AlertTriangle color="#F59E0B" size={20} />
                        <Text style={[st.infoText, { color: isDark ? '#FCD34D' : '#92400E' }]}>Files in trash are automatically deleted after 30 days.</Text>
                    </View>

                    <View style={st.emptyState}>
                        <View style={[st.emptyIconBox, { backgroundColor: isDark ? '#1C1C2A' : '#F8FAFC' }]}>
                            <Trash2 color={TEXT_SUB} size={48} strokeWidth={1} />
                        </View>
                        <Text style={[st.emptyTitle, { color: TEXT_MAIN }]}>Trash is empty</Text>
                        <Text style={[st.emptySub, { color: TEXT_SUB }]}>No files have been deleted recently.</Text>
                    </View>
                    
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
    headerTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
    loaderView: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    scroll: { paddingHorizontal: 20, paddingBottom: 24, paddingTop: 8, flexGrow: 1 },
    
    infoCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        gap: 12,
        marginBottom: 32,
    },
    infoText: {
        flex: 1,
        fontSize: 14,
        fontWeight: '500',
        lineHeight: 20,
    },

    emptyState: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingBottom: 60,
        marginTop: 40,
    },
    emptyIconBox: {
        width: 100,
        height: 100,
        borderRadius: 50,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 20,
    },
    emptyTitle: {
        fontSize: 22,
        fontWeight: '700',
        marginBottom: 8,
        letterSpacing: -0.5,
    },
    emptySub: {
        fontSize: 15,
        fontWeight: '500',
        textAlign: 'center',
        maxWidth: 240,
    },
});
