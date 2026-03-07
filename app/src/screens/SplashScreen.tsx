import React, { useEffect, useMemo, useRef } from 'react';
import {
    Animated,
    Easing,
    Platform,
    StatusBar,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { FileText, Folder, Image as ImageIcon, Film } from 'lucide-react-native';

const ND = Platform.OS !== 'web';

interface Props {
    onFinish: () => void;
}

const ORBIT_ITEMS = [
    { Icon: Folder, color: '#4B6EF5', bg: 'rgba(255,255,255,0.78)', x: 0, y: -138 },
    { Icon: ImageIcon, color: '#06B6D4', bg: 'rgba(255,255,255,0.78)', x: 124, y: -16 },
    { Icon: Film, color: '#8B5CF6', bg: 'rgba(255,255,255,0.78)', x: 0, y: 128 },
    { Icon: FileText, color: '#F59E0B', bg: 'rgba(255,255,255,0.78)', x: -126, y: -10 },
] as const;

export default function SplashScreen({ onFinish }: Props) {
    const heroScale = useRef(new Animated.Value(0.86)).current;
    const heroOpacity = useRef(new Animated.Value(0)).current;
    const textOpacity = useRef(new Animated.Value(0)).current;
    const orbitSpin = useRef(new Animated.Value(0)).current;
    const glowPulse = useRef(new Animated.Value(0)).current;
    const floatA = useRef(new Animated.Value(0)).current;
    const floatB = useRef(new Animated.Value(0)).current;
    const floatC = useRef(new Animated.Value(0)).current;
    const floatD = useRef(new Animated.Value(0)).current;
    const exitOpacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        const spinLoop = Animated.loop(
            Animated.timing(orbitSpin, {
                toValue: 1,
                duration: 10000,
                easing: Easing.linear,
                useNativeDriver: ND,
            })
        );

        const pulseLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(glowPulse, { toValue: 1, duration: 1800, useNativeDriver: ND }),
                Animated.timing(glowPulse, { toValue: 0, duration: 1800, useNativeDriver: ND }),
            ])
        );

        const bob = (value: Animated.Value, duration: number) =>
            Animated.loop(
                Animated.sequence([
                    Animated.timing(value, { toValue: 1, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: ND }),
                    Animated.timing(value, { toValue: 0, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: ND }),
                ])
            );

        const bobA = bob(floatA, 2200);
        const bobB = bob(floatB, 1800);
        const bobC = bob(floatC, 2100);
        const bobD = bob(floatD, 2000);

        spinLoop.start();
        pulseLoop.start();
        bobA.start();
        bobB.start();
        bobC.start();
        bobD.start();

        Animated.sequence([
            Animated.parallel([
                Animated.spring(heroScale, {
                    toValue: 1,
                    tension: 60,
                    friction: 8,
                    useNativeDriver: ND,
                }),
                Animated.timing(heroOpacity, {
                    toValue: 1,
                    duration: 560,
                    useNativeDriver: ND,
                }),
            ]),
            Animated.timing(textOpacity, {
                toValue: 1,
                duration: 340,
                useNativeDriver: ND,
            }),
            Animated.delay(550),
            Animated.timing(exitOpacity, {
                toValue: 1,
                duration: 260,
                useNativeDriver: ND,
            }),
        ]).start(() => onFinish());

        return () => {
            spinLoop.stop();
            pulseLoop.stop();
            bobA.stop();
            bobB.stop();
            bobC.stop();
            bobD.stop();
        };
    }, [exitOpacity, floatA, floatB, floatC, floatD, glowPulse, heroOpacity, heroScale, onFinish, orbitSpin, textOpacity]);

    const orbitRotate = orbitSpin.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    });

    const glowScale = glowPulse.interpolate({
        inputRange: [0, 1],
        outputRange: [1, 1.1],
    });

    const bobTransforms = useMemo(
        () => [
            floatA.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }),
            floatB.interpolate({ inputRange: [0, 1], outputRange: [0, 7] }),
            floatC.interpolate({ inputRange: [0, 1], outputRange: [0, -9] }),
            floatD.interpolate({ inputRange: [0, 1], outputRange: [0, 8] }),
        ],
        [floatA, floatB, floatC, floatD]
    );

    return (
        <View style={styles.container}>
            <StatusBar barStyle="dark-content" backgroundColor="#F4F6FB" />

            <LinearGradient
                colors={['#F4F6FB', '#EEF1FD', '#E8EEFF']}
                locations={[0, 0.55, 1]}
                style={StyleSheet.absoluteFill}
            />

            <View style={styles.rayTop} />
            <View style={styles.rayBottom} />

            <Animated.View
                style={[
                    styles.heroWrap,
                    {
                        opacity: heroOpacity,
                        transform: [{ scale: heroScale }],
                    },
                ]}
            >
                <Animated.View
                    style={[
                        styles.glowRing,
                        {
                            transform: [{ scale: glowScale }],
                        },
                    ]}
                />

                <View style={styles.cloudShell}>
                    <View style={styles.cloudMain} />
                    <View style={styles.cloudBumpLeft} />
                    <View style={styles.cloudBumpRight} />
                    <Image
                        source={require('../../assets/axya_logo.png')}
                        style={styles.logoCore}
                        contentFit="contain"
                    />
                </View>

                <Animated.View style={[styles.orbitLayer, { transform: [{ rotate: orbitRotate }] }]}>
                    {ORBIT_ITEMS.map((item, idx) => {
                        const Icon = item.Icon;
                        return (
                            <Animated.View
                                key={`${item.color}-${idx}`}
                                style={[
                                    styles.fileBadge,
                                    {
                                        backgroundColor: item.bg,
                                        left: item.x + 150,
                                        top: item.y + 150,
                                        transform: [{ translateY: bobTransforms[idx] }],
                                    },
                                ]}
                            >
                                <Icon size={18} color={item.color} strokeWidth={2.2} />
                            </Animated.View>
                        );
                    })}
                </Animated.View>
            </Animated.View>

            <Animated.Text style={[styles.appName, { opacity: textOpacity }]}>Axya</Animated.Text>
            <Animated.Text style={[styles.tagline, { opacity: textOpacity }]}>The Vessel That Never Empties</Animated.Text>

            <Animated.View
                style={[
                    StyleSheet.absoluteFillObject,
                    {
                        backgroundColor: '#F4F6FB',
                        opacity: exitOpacity,
                        pointerEvents: 'none',
                    },
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
    rayTop: {
        position: 'absolute',
        top: -110,
        width: 460,
        height: 320,
        borderRadius: 999,
        backgroundColor: 'rgba(75, 110, 245, 0.10)',
        transform: [{ rotate: '-12deg' }],
    },
    rayBottom: {
        position: 'absolute',
        bottom: -140,
        width: 430,
        height: 280,
        borderRadius: 999,
        backgroundColor: 'rgba(139, 92, 246, 0.08)',
        transform: [{ rotate: '10deg' }],
    },
    heroWrap: {
        width: 300,
        height: 300,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 28,
    },
    glowRing: {
        position: 'absolute',
        width: 208,
        height: 208,
        borderRadius: 999,
        backgroundColor: 'rgba(75, 110, 245, 0.14)',
        shadowColor: '#4B6EF5',
        shadowOffset: { width: 0, height: 20 },
        shadowOpacity: 0.28,
        shadowRadius: 34,
        elevation: 14,
    },
    cloudShell: {
        width: 170,
        height: 130,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cloudMain: {
        position: 'absolute',
        width: 150,
        height: 78,
        borderRadius: 40,
        backgroundColor: 'rgba(255,255,255,0.92)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.95)',
        shadowColor: '#4B6EF5',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.16,
        shadowRadius: 24,
        elevation: 10,
    },
    cloudBumpLeft: {
        position: 'absolute',
        top: 14,
        left: 24,
        width: 52,
        height: 52,
        borderRadius: 26,
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.95)',
    },
    cloudBumpRight: {
        position: 'absolute',
        top: 6,
        right: 30,
        width: 60,
        height: 60,
        borderRadius: 30,
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.95)',
    },
    logoCore: {
        width: 56,
        height: 56,
        borderRadius: 16,
        backgroundColor: '#FFFFFF',
    },
    orbitLayer: {
        position: 'absolute',
        width: 300,
        height: 300,
    },
    fileBadge: {
        position: 'absolute',
        width: 44,
        height: 44,
        borderRadius: 14,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.92)',
        shadowColor: '#1A1F36',
        shadowOffset: { width: 0, height: 7 },
        shadowOpacity: 0.1,
        shadowRadius: 14,
        elevation: 5,
    },
    appName: {
        fontSize: 44,
        fontWeight: '800',
        letterSpacing: -1.2,
        color: '#1A1F36',
        marginBottom: 8,
    },
    tagline: {
        fontSize: 14,
        color: '#475569',
        letterSpacing: 0.25,
        fontWeight: '500',
    },
});