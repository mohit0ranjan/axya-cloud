/**
 * SplashScreen.tsx — Premium animated splash with smooth exit
 *
 * ✅ Simple, fast animation (logo scale + fade, text fade)
 * ✅ Minimal animated values (4 instead of 10)
 * ✅ useNativeDriver: true on all animations
 * ✅ No Animated.multiply (avoids JS thread computation)
 * ✅ Clean fade-out exit
 * ✅ Matching background color with app.json splash (#ffffff → #F4F6FB)
 */

import React, { useEffect, useRef } from 'react';
import {
    View, Text, StyleSheet, Animated, StatusBar, Platform,
} from 'react-native';
import { Image } from 'expo-image';

const ND = Platform.OS !== 'web'; // useNativeDriver only on native

interface Props {
    onFinish: () => void;
}

export default function SplashScreen({ onFinish }: Props) {
    // Only 4 animated values — minimal JS overhead
    const logoScale = useRef(new Animated.Value(0.6)).current;
    const logoOpacity = useRef(new Animated.Value(0)).current;
    const textOpacity = useRef(new Animated.Value(0)).current;
    const exitOpacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        // Phase 1: Logo entrance (spring scale + fade-in) — 500ms
        // Phase 2: Text fade-in — 300ms
        // Phase 3: Hold — 800ms
        // Phase 4: Exit fade — 300ms
        // Total: ~1900ms (fast, premium feel)

        Animated.sequence([
            // ── Logo entrance ──
            Animated.parallel([
                Animated.spring(logoScale, {
                    toValue: 1,
                    tension: 80,
                    friction: 10,
                    useNativeDriver: ND,
                }),
                Animated.timing(logoOpacity, {
                    toValue: 1,
                    duration: 400,
                    useNativeDriver: ND,
                }),
            ]),

            // ── Text fade-in ──
            Animated.timing(textOpacity, {
                toValue: 1,
                duration: 300,
                useNativeDriver: ND,
            }),

            // ── Hold for a beat ──
            Animated.delay(250),

            // ── Exit fade ──
            Animated.timing(exitOpacity, {
                toValue: 1,
                duration: 250,
                useNativeDriver: ND,
            }),
        ]).start(() => {
            // Animation complete — hand off to app
            onFinish();
        });
    }, []);

    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor="#F4F6FB" />

            {/* Logo */}
            <Animated.View style={{
                opacity: logoOpacity,
                transform: [{ scale: logoScale }],
                marginBottom: 24,
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
            <Animated.Text style={[styles.tagline, { opacity: textOpacity }]}>
                The vessel that never empties
            </Animated.Text>

            {/* Bottom label */}
            <Animated.Text style={[styles.bottom, { opacity: textOpacity }]}>
                Secured by Telegram
            </Animated.Text>

            {/* Exit overlay — fades to background color */}
            <Animated.View
                style={[
                    StyleSheet.absoluteFillObject,
                    {
                        backgroundColor: '#F4F6FB',
                        opacity: exitOpacity,
                        pointerEvents: 'none',
                    } as any,
                ]}
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
        width: 100,
        height: 100,
        borderRadius: 24,
        ...Platform.select({
            ios: {
                shadowColor: '#4B6EF5',
                shadowOffset: { width: 0, height: 10 },
                shadowOpacity: 0.15,
                shadowRadius: 20,
            },
            android: { elevation: 8 },
        }),
    },
    appName: {
        fontSize: 42,
        fontWeight: '800',
        color: '#1A1F36',
        letterSpacing: -1.5,
        marginBottom: 6,
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
});
