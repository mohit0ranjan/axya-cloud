import React, { useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, TouchableOpacity,
    SafeAreaView, Animated, Easing, Dimensions, StatusBar,
} from 'react-native';
import { Image } from '../components/AppImage';
import { ArrowRight, ArrowLeft } from 'lucide-react-native';

const { width, height } = Dimensions.get('window');

// Scattered decorative dots — same positions as the screenshot
const DOTS = [
    { top: 0.07, left: 0.05, size: 11, color: '#4B6EF5' },
    { top: 0.10, left: 0.80, size: 8, color: '#FCBD0B' },
    { top: 0.20, left: 0.10, size: 7, color: '#EF4444' },
    { top: 0.17, left: 0.72, size: 10, color: '#4B6EF5' },
    { top: 0.33, left: 0.88, size: 6, color: '#1FD45A' },
    { top: 0.50, left: 0.04, size: 9, color: '#FCBD0B' },
    { top: 0.58, left: 0.88, size: 7, color: '#4B6EF5' },
    { top: 0.42, left: 0.78, size: 5, color: '#EF4444' },
];

export default function WelcomeScreen({ navigation }: any) {
    const heroOpacity = useRef(new Animated.Value(0)).current;
    const heroScale = useRef(new Animated.Value(0.72)).current;
    const sheetY = useRef(new Animated.Value(180)).current;
    const sheetOpacity = useRef(new Animated.Value(0)).current;
    const floatAnim = useRef(new Animated.Value(0)).current;
    const dotAnims = useRef(DOTS.map(() => new Animated.Value(0))).current;

    useEffect(() => {
        // --- 1. Hero icon entrance
        Animated.parallel([
            Animated.spring(heroScale, { toValue: 1, tension: 52, friction: 7, useNativeDriver: true }),
            Animated.timing(heroOpacity, { toValue: 1, duration: 550, useNativeDriver: true }),
        ]).start();

        // --- 2. Floating card slides up
        Animated.parallel([
            Animated.spring(sheetY, { toValue: 0, tension: 44, friction: 9, delay: 250, useNativeDriver: true }),
            Animated.timing(sheetOpacity, { toValue: 1, duration: 450, delay: 250, useNativeDriver: true }),
        ]).start();

        // --- 3. Dots stagger in
        Animated.stagger(70, dotAnims.map(a =>
            Animated.timing(a, { toValue: 1, duration: 400, useNativeDriver: true })
        )).start();

        // --- 4. Hero float loop
        const float = Animated.loop(
            Animated.sequence([
                Animated.timing(floatAnim, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
                Animated.timing(floatAnim, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
            ])
        );
        const t = setTimeout(() => float.start(), 700);
        return () => { clearTimeout(t); float.stop(); };
    }, []);

    const floatY = floatAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -13] });

    return (
        <View style={styles.root}>
            <StatusBar barStyle="dark-content" backgroundColor="#F4F6FB" />

            {/* ── Decorative dots ── */}
            {DOTS.map((d, i) => (
                <Animated.View
                    key={i}
                    style={{
                        position: 'absolute',
                        top: height * d.top,
                        left: width * d.left,
                        width: d.size,
                        height: d.size,
                        borderRadius: d.size / 2,
                        backgroundColor: d.color,
                        opacity: dotAnims[i].interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] }),
                    }}
                />
            ))}

            {/* ── Back arrow ── */}
            <SafeAreaView style={{ position: 'absolute', top: 0, left: 0 }}>
                <TouchableOpacity
                    style={styles.backBtn}
                    onPress={() => {
                        // Only go back if we're not at the root of the stack
                        if (navigation.canGoBack()) {
                            navigation.goBack();
                        }
                    }}
                >
                    <ArrowLeft color="#8892A4" size={22} />
                </TouchableOpacity>
            </SafeAreaView>

            {/* ── Hero illustration (cloud + lock) ── */}
            <View style={styles.heroArea}>
                <Animated.View style={{
                    transform: [{ scale: heroScale }, { translateY: floatY }],
                    opacity: heroOpacity,
                    alignItems: 'center',
                    justifyContent: 'center',
                }}>
                    {/* Warm blob */}
                    <View style={styles.blob} />

                    {/* Cloud ring  */}
                    <View style={styles.iconStack}>
                        {/* Cloud stroke — drawn with a View + border trick for warm golden look */}
                        <View style={styles.cloudOuter}>
                            <View style={styles.cloudInner} />
                            <View style={styles.cloudBump1} />
                            <View style={styles.cloudBump2} />
                        </View>
                        {/* Lock badge */}
                        <View style={styles.lockBadge}>
                            <View style={styles.lockBody}>
                                <View style={styles.lockShackle} />
                                <View style={styles.lockBodyRect} />
                            </View>
                        </View>
                    </View>
                </Animated.View>
            </View>

            {/* ── Floating bottom sheet ── */}
            <Animated.View style={[styles.sheet, {
                opacity: sheetOpacity,
                transform: [{ translateY: sheetY }],
            }]}>
                <View style={styles.sheetHandle} />

                <Text style={styles.headline}>
                    Your <Text style={styles.headlineAccent}>Infinite</Text> Drive
                </Text>
                <Text style={styles.subtitle}>
                    Secure, unlimited cloud storage powered by{'\n'}
                    the ultra-fast Telegram API. Store entirely{'\n'}
                    anything without limits.
                </Text>

                {/* Axya brand pill */}
                <View style={styles.brandPill}>
                    <Image
                        source={require('../../assets/axya_logo.png')}
                        style={styles.brandLogo}
                        contentFit="contain"
                    />
                    <Text style={styles.brandName}>Axya</Text>
                </View>

                {/* CTA */}
                <TouchableOpacity
                    style={styles.ctaBtn}
                    activeOpacity={0.85}
                    onPress={() => navigation.navigate('Auth')}
                >
                    <Text style={styles.ctaText}>Get Started</Text>
                    <ArrowRight color="#fff" size={20} />
                </TouchableOpacity>

                <Text style={styles.finePrint}>No account needed · Just your Telegram</Text>
            </Animated.View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#F4F6FB',
    },
    backBtn: { padding: 18, marginTop: 4 },

    // Hero
    heroArea: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 320,           // leaves room for the floating sheet
        alignItems: 'center',
        justifyContent: 'center',
    },
    blob: {
        position: 'absolute',
        width: 285,
        height: 285,
        borderRadius: 9999,
        backgroundColor: '#F5E6C8',
        opacity: 0.7,
    },

    // Hand-drawn cloud (matching the golden wireframe style)
    iconStack: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
    cloudOuter: {
        width: 100, height: 66,
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    cloudInner: {
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        height: 46,
        borderRadius: 23,
        borderWidth: 3.5,
        borderColor: '#F59E0B',
        backgroundColor: 'transparent',
    },
    cloudBump1: {
        position: 'absolute',
        top: 2, left: 16,
        width: 44, height: 44,
        borderRadius: 22,
        borderWidth: 3.5,
        borderColor: '#F59E0B',
        backgroundColor: 'transparent',
    },
    cloudBump2: {
        position: 'absolute',
        top: 10, right: 10,
        width: 32, height: 32,
        borderRadius: 16,
        borderWidth: 3.5,
        borderColor: '#F59E0B',
        backgroundColor: 'transparent',
    },
    lockBadge: {
        position: 'absolute',
        bottom: -16,
        right: -20,
        width: 52,
        height: 52,
        borderRadius: 16,
        backgroundColor: '#fff',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#4B6EF5',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius: 14,
        elevation: 10,
    },
    lockBody: { alignItems: 'center' },
    lockShackle: {
        width: 16, height: 10,
        borderTopLeftRadius: 8, borderTopRightRadius: 8,
        borderWidth: 3, borderColor: '#4B6EF5',
        borderBottomWidth: 0,
        marginBottom: -2,
    },
    lockBodyRect: {
        width: 22, height: 16,
        borderRadius: 5,
        backgroundColor: '#4B6EF5',
    },

    // ── Floating bottom sheet ──
    sheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: '#fff',
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        paddingHorizontal: 28,
        paddingTop: 16,
        paddingBottom: 36,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.07,
        shadowRadius: 24,
        elevation: 20,
        gap: 14,
    },
    sheetHandle: {
        width: 40, height: 4,
        borderRadius: 2,
        backgroundColor: '#E2E8F0',
        marginBottom: 6,
    },
    headline: {
        fontSize: 32,
        fontWeight: '400',
        color: '#1A1F36',
        textAlign: 'center',
        lineHeight: 40,
    },
    headlineAccent: { fontWeight: '800', color: '#1A1F36' },
    subtitle: {
        fontSize: 14,
        color: '#8892A4',
        textAlign: 'center',
        lineHeight: 22,
    },

    // Axya pill
    brandPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F4F6FB',
        borderRadius: 20,
        paddingVertical: 8,
        paddingHorizontal: 16,
        gap: 8,
        borderWidth: 1,
        borderColor: '#EAEDF3',
    },
    brandLogo: { width: 24, height: 24, borderRadius: 6 },
    brandName: { fontSize: 15, fontWeight: '800', color: '#1A1F36', letterSpacing: -0.5 },

    // CTA
    ctaBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        backgroundColor: '#4B6EF5',
        borderRadius: 20,
        paddingVertical: 18,
        width: '100%',
        shadowColor: '#4B6EF5',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.30,
        shadowRadius: 16,
        elevation: 8,
    },
    ctaText: { fontSize: 17, fontWeight: '700', color: '#fff' },
    finePrint: { fontSize: 12, color: '#B0BAC9' },
});
