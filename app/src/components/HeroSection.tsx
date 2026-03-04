import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Image } from 'expo-image';
import { Shield, Zap, HardDrive } from 'lucide-react-native';

const FEATURES = [
    { icon: Shield, label: 'MTProto Encrypted', color: '#4B6EF5', bg: '#EEF1FD' },
    { icon: Zap, label: 'Instant Upload', color: '#E5A400', bg: '#FFFBEB' },
    { icon: HardDrive, label: 'Unlimited Space', color: '#16A34A', bg: '#F0FDF4' },
];

interface HeroSectionProps {
    keyboardVisible: boolean;
    heroOpacity: Animated.Value;
    heroScale: Animated.Value;
    heroShrink: Animated.Value;
    heroFadeOut: Animated.Value;
}

// Fix #9: Wrap in React.memo
export default React.memo(function HeroSection({
    keyboardVisible,
    heroOpacity,
    heroScale,
    heroShrink,
    heroFadeOut,
}: HeroSectionProps) {
    const floatAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const float = Animated.loop(
            Animated.sequence([
                Animated.timing(floatAnim, { toValue: 1, duration: 2200, useNativeDriver: true }),
                Animated.timing(floatAnim, { toValue: 0, duration: 2200, useNativeDriver: true }),
            ])
        );
        float.start();
        return () => float.stop();
    }, []);

    const floatY = floatAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });

    return (
        <Animated.View style={[
            styles.heroArea,
            // Fix #7: When keyboard is visible, collapse to 0 instead of leaving 120px dead space
            keyboardVisible && styles.heroAreaKeyboard,
            {
                opacity: Animated.multiply(heroOpacity, heroFadeOut),
                transform: [{ scale: Animated.multiply(heroScale, heroShrink) }],
            },
        ]}>
            <Animated.View style={{
                transform: [{ translateY: floatY }],
                alignItems: 'center',
            }}>
                <View style={styles.blobOuter} />
                <View style={styles.blobInner} />
                <View style={styles.logoCircle}>
                    <Image
                        source={require('../../assets/axya_logo.png')}
                        style={styles.logoImg}
                        contentFit="contain"
                    />
                </View>

                <Text style={styles.heroTitle}>Secure Telegram Cloud</Text>
                <Text style={styles.heroSubtitle}>Unlimited encrypted storage powered by Telegram</Text>

                <View style={styles.featureRow}>
                    {FEATURES.map((f) => {
                        const FIcon = f.icon;
                        return (
                            <View key={f.label} style={[styles.featurePill, { backgroundColor: f.bg }]}>
                                <FIcon color={f.color} size={13} strokeWidth={2.5} />
                                <Text style={[styles.featurePillText, { color: f.color }]}>{f.label}</Text>
                            </View>
                        );
                    })}
                </View>
            </Animated.View>
        </Animated.View>
    );
});

const styles = StyleSheet.create({
    heroArea: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        minHeight: 280,
    },
    // Fix #7: Collapse fully when keyboard is visible (opacity handles the hiding)
    heroAreaKeyboard: {
        flex: 0,
        minHeight: 0,
        maxHeight: 0,
        overflow: 'hidden',
    },
    blobOuter: {
        position: 'absolute',
        width: 320, height: 320,
        borderRadius: 9999,
        backgroundColor: '#E8EFFE',
        opacity: 0.35,
        top: -60,
    },
    blobInner: {
        position: 'absolute',
        width: 220, height: 220,
        borderRadius: 9999,
        backgroundColor: '#D6DFFD',
        opacity: 0.30,
        top: -10,
    },
    logoCircle: {
        width: 96, height: 96,
        borderRadius: 28,
        backgroundColor: '#fff',
        justifyContent: 'center', alignItems: 'center',
        shadowColor: '#4B6EF5',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.20,
        shadowRadius: 32,
        elevation: 12,
        marginBottom: 24,
    },
    logoImg: { width: 68, height: 68, borderRadius: 18 },
    heroTitle: {
        fontSize: 26,
        fontWeight: '700',
        color: '#0F172A',
        letterSpacing: -0.3,
        marginBottom: 8,
    },
    heroSubtitle: {
        fontSize: 15,
        color: '#64748B',
        fontWeight: '400',
        marginBottom: 24,
        textAlign: 'center',
        maxWidth: '85%',
        lineHeight: 22,
    },
    featureRow: {
        flexDirection: 'row',
        gap: 8,
        flexWrap: 'wrap',
        justifyContent: 'center',
        paddingHorizontal: 16
    },
    featurePill: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingVertical: 8, paddingHorizontal: 14,
        borderRadius: 24,
    },
    featurePillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.1 },
});
