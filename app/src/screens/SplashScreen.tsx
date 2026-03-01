import React, { useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, Animated, Easing, Dimensions, StatusBar, Platform,
} from 'react-native';
import { Image } from 'expo-image';

const { width, height } = Dimensions.get('window');
// useNativeDriver only available on native, not on web
const ND = Platform.OS !== 'web';

interface Props {
    onFinish: () => void;
}

export default function SplashScreen({ onFinish }: Props) {
    const logoScale = useRef(new Animated.Value(0.4)).current;
    const logoOpacity = useRef(new Animated.Value(0)).current;
    const textOpacity = useRef(new Animated.Value(0)).current;
    const taglineOpacity = useRef(new Animated.Value(0)).current;
    const exitOpacity = useRef(new Animated.Value(0)).current;
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const ring1Opacity = useRef(new Animated.Value(0)).current;
    const ring1Scale = useRef(new Animated.Value(0.5)).current;
    const ring2Opacity = useRef(new Animated.Value(0)).current;
    const ring2Scale = useRef(new Animated.Value(0.5)).current;

    useEffect(() => {
        // 1. Logo entrance spring
        Animated.sequence([
            Animated.parallel([
                Animated.spring(logoScale, { toValue: 1, tension: 55, friction: 7, useNativeDriver: ND }),
                Animated.timing(logoOpacity, { toValue: 1, duration: 500, useNativeDriver: ND }),
            ]),
            // 2. Rings radiate out
            Animated.parallel([
                Animated.timing(ring1Opacity, { toValue: 0.18, duration: 400, useNativeDriver: ND }),
                Animated.spring(ring1Scale, { toValue: 1, tension: 40, friction: 8, useNativeDriver: ND }),
                Animated.timing(ring2Opacity, { toValue: 0.09, duration: 600, delay: 150, useNativeDriver: ND }),
                Animated.spring(ring2Scale, { toValue: 1, tension: 30, friction: 9, useNativeDriver: ND }),
            ]),
            // 3. App name
            Animated.timing(textOpacity, { toValue: 1, duration: 400, useNativeDriver: ND }),
            // 4. Tagline
            Animated.timing(taglineOpacity, { toValue: 1, duration: 350, useNativeDriver: ND }),
        ]).start();

        // 5. Gentle pulse on logo
        const pulse = Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, { toValue: 1.05, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: ND }),
                Animated.timing(pulseAnim, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: ND }),
            ])
        );
        const pulseTimeout = setTimeout(() => pulse.start(), 900);

        // 6. Fade out and call onFinish
        const exitTimeout = setTimeout(() => {
            Animated.timing(exitOpacity, { toValue: 1, duration: 350, useNativeDriver: ND }).start(() => onFinish());
        }, 2700);

        return () => {
            clearTimeout(pulseTimeout);
            clearTimeout(exitTimeout);
            pulse.stop();
        };
    }, []);

    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor="#F4F6FB" />

            {/* Decorative rings (use PRIMARY blue, subtle) */}
            <Animated.View style={[
                styles.ring, styles.ring2,
                { opacity: ring2Opacity, transform: [{ scale: ring2Scale }] }
            ]} />
            <Animated.View style={[
                styles.ring, styles.ring1,
                { opacity: ring1Opacity, transform: [{ scale: ring1Scale }] }
            ]} />

            {/* Logo */}
            <Animated.View style={{
                transform: [{ scale: Animated.multiply(logoScale, pulseAnim) }],
                opacity: logoOpacity,
                marginBottom: 28,
            }}>
                <Image
                    source={require('../../assets/axya_logo.png')}
                    style={styles.logo}
                    contentFit="contain"
                />
            </Animated.View>

            {/* App name */}
            <Animated.Text style={[styles.appName, { opacity: textOpacity }]}>
                Axya
            </Animated.Text>

            {/* Tagline */}
            <Animated.Text style={[styles.tagline, { opacity: taglineOpacity }]}>
                The vessel that never empties
            </Animated.Text>

            {/* Bottom label */}
            <Animated.Text style={[styles.bottom, { opacity: taglineOpacity }]}>
                Secured by Telegram
            </Animated.Text>

            {/* Exit overlay — pointerEvents in style to avoid deprecation */}
            <Animated.View
                style={[StyleSheet.absoluteFillObject, { backgroundColor: '#F4F6FB', opacity: exitOpacity, pointerEvents: 'none' } as any]}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F4F6FB',
        alignItems: 'center',
        justifyContent: 'center',
    },
    logo: {
        width: 110,
        height: 110,
        borderRadius: 28,
        // subtle card shadow
        shadowColor: '#4B6EF5',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.18,
        shadowRadius: 24,
        elevation: 10,
    },
    appName: {
        fontSize: 46,
        fontWeight: '800',
        color: '#1A1F36',
        letterSpacing: -1.5,
        marginBottom: 8,
    },
    tagline: {
        fontSize: 14,
        color: '#8892A4',
        letterSpacing: 0.3,
    },
    bottom: {
        position: 'absolute',
        bottom: 52,
        fontSize: 12,
        color: '#B0BAC9',
        letterSpacing: 0.2,
    },
    ring: {
        position: 'absolute',
        borderRadius: 9999,
        borderWidth: 1.5,
        borderColor: '#4B6EF5',
    },
    ring1: {
        width: 200,
        height: 200,
    },
    ring2: {
        width: 320,
        height: 320,
    },
});
