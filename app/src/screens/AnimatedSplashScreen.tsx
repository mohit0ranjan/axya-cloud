import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, Platform, useWindowDimensions, Image } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    withDelay,
    withRepeat,
    Easing,
    runOnJS
} from 'react-native-reanimated';
import { File, Image as ImageIcon, Video, FileText } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { useTheme } from '../context/ThemeContext';

interface Props {
    onAnimationComplete: () => void;
    isAuthLoading: boolean;
}

ExpoSplashScreen.preventAutoHideAsync().catch(() => { });

export default function AnimatedSplashScreen({ onAnimationComplete, isAuthLoading }: Props) {
    const { theme, isDark } = useTheme();
    const C = theme.colors;
    const { height } = useWindowDimensions();
    const styles = React.useMemo(() => createStyles(C, isDark), [C, isDark]);
    const [isAppReady, setIsAppReady] = useState(false);
    const [isAnimationFinished, setIsAnimationFinished] = useState(false);

    // Animation Values
    const iconScale = useSharedValue(0.92);
    const iconOpacity = useSharedValue(0);
    const textOpacity = useSharedValue(0);
    const textTranslateY = useSharedValue(12);
    const particleOpacity = useSharedValue(0);
    const containerOpacity = useSharedValue(1);
    const orbitRotation = useSharedValue(0);
    const glowPulse = useSharedValue(0);

    // 1. Wait for JS to be ready
    useEffect(() => {
        const prepare = async () => {
            try {
                await new Promise(resolve => setTimeout(resolve, 50));
            } finally {
                setIsAppReady(true);
            }
        };
        prepare();
    }, []);

    // 2. Start Animation
    useEffect(() => {
        if (!isAppReady) return;

        ExpoSplashScreen.hideAsync().then(() => {

            // Icon fade and scale
            iconScale.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) });
            iconOpacity.value = withTiming(1, { duration: 600 });

            // Glowing background pulse
            glowPulse.value = withRepeat(
                withTiming(1, { duration: 2500, easing: Easing.inOut(Easing.ease) }),
                -1,
                true
            );

            // Orbit Rotation (slow continuous)
            orbitRotation.value = withRepeat(
                withTiming(360, { duration: 30000, easing: Easing.linear }),
                -1,
                false
            );

            // Particles fade in slightly after
            particleOpacity.value = withDelay(
                600,
                withTiming(1, { duration: 1000 })
            );

            // Text fades in and floats up
            textOpacity.value = withDelay(
                800,
                withTiming(1, { duration: 800 })
            );
            textTranslateY.value = withDelay(
                800,
                withTiming(0, { duration: 800, easing: Easing.out(Easing.cubic) })
            );

            const timer = setTimeout(() => {
                setIsAnimationFinished(true);
            }, 2500); // Wait longer before navigating away

            return () => clearTimeout(timer);
        });
    }, [isAppReady]);

    // 3. Unmount sequence
    useEffect(() => {
        if (isAnimationFinished && !isAuthLoading) {
            containerOpacity.value = withTiming(0, { duration: 500 }, (finished) => {
                if (finished) {
                    runOnJS(onAnimationComplete)();
                }
            });
        }
    }, [isAnimationFinished, isAuthLoading, onAnimationComplete, containerOpacity]);

    const iconContainerStyle = useAnimatedStyle(() => ({
        opacity: iconOpacity.value,
        transform: [{ scale: iconScale.value }],
    }));

    const glowStyle = useAnimatedStyle(() => ({
        opacity: iconOpacity.value,
        transform: [{ scale: 1 + glowPulse.value * 0.1 }],
    }));

    const textStyle = useAnimatedStyle(() => ({
        opacity: textOpacity.value,
        transform: [{ translateY: textTranslateY.value }],
        alignItems: 'center',
        marginTop: 52,
    }));

    const particlesStyle = useAnimatedStyle(() => ({
        opacity: particleOpacity.value,
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
    }));

    const orbitStyle = useAnimatedStyle(() => ({
        ...StyleSheet.absoluteFillObject,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ rotate: `${orbitRotation.value}deg` }],
    }));

    const wrapperStyle = useAnimatedStyle(() => ({
        flex: 1,
        opacity: containerOpacity.value,
    }));

    const translateYOffset = -(height * 0.08);
    const orbitRadius = 130; // Distance of icons from center

    return (
        <Animated.View style={[styles.background, wrapperStyle, { zIndex: 99999 }]}>
            {/* Background Gradient */}
            <LinearGradient
                colors={[C.background, C.surfaceMuted]}
                style={StyleSheet.absoluteFill}
            />

            <View style={[styles.centerContainer, { transform: [{ translateY: translateYOffset }] }]}>

                {/* 4. Motion Hint: Faint Orbit Ring */}
                <View style={styles.orbitRing} />

                {/* 3. Floating Micro Elements on the Orbit */}
                <Animated.View style={[particlesStyle, orbitStyle]}>
                    <View style={[styles.floatingIcon, { transform: [{ translateY: -orbitRadius }] }]}>
                        <File color={C.textBody} size={18} />
                    </View>
                    <View style={[styles.floatingIcon, { transform: [{ translateY: orbitRadius }] }]}>
                        <ImageIcon color={C.textBody} size={18} />
                    </View>
                    <View style={[styles.floatingIcon, { transform: [{ translateX: -orbitRadius }] }]}>
                        <Video color={C.textBody} size={18} />
                    </View>
                    <View style={[styles.floatingIcon, { transform: [{ translateX: orbitRadius }] }]}>
                        <FileText color={C.textBody} size={18} />
                    </View>
                </Animated.View>

                {/* 1. Faint Radial Glow */}
                <Animated.View style={[styles.faintGlow, glowStyle]} />

                {/* 2. Icon Container with Glass Effect */}
                <Animated.View style={[styles.glassContainer, iconContainerStyle]}>
                    <LinearGradient
                        colors={[C.card, C.surfaceMuted]}
                        style={styles.glassGradient}
                    />
                    <Image
                        source={require('../../assets/icon.png')}
                        style={styles.appIcon}
                        resizeMode="contain"
                    />
                </Animated.View>

                {/* 5. Typography Polish */}
                <Animated.View style={textStyle}>
                    <Text style={styles.title}>AXYA</Text>
                    <Text style={styles.tagline}>The Vessel That Never Empties</Text>
                </Animated.View>
            </View>
        </Animated.View>
    );
}

const createStyles = (C: any, isDark: boolean) => StyleSheet.create({
    background: {
        flex: 1,
        width: '100%',
        height: '100%',
        position: 'absolute',
    },
    centerContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    orbitRing: {
        position: 'absolute',
        width: 260,
        height: 260,
        borderRadius: 130,
        borderWidth: 1.5,
        borderColor: C.textBody,
        opacity: 0.06, // Very low 5-8% opacity
    },
    floatingIcon: {
        position: 'absolute',
        opacity: 0.12, // 10-15% opacity
    },
    faintGlow: {
        position: 'absolute',
        width: 280,
        height: 280,
        borderRadius: 140,
        backgroundColor: C.primary,
        opacity: isDark ? 0.08 : 0.15, // Extremely faint
        filter: 'blur(30px)', // Only works on web, simulated by radial gradient otherwise
    },
    glassContainer: {
        width: 135,
        height: 135,
        borderRadius: 38, // Slightly larger radius
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden', // To keep gradient inside radius
        backgroundColor: C.card,
        shadowColor: C.textHeading,
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: isDark ? 0.4 : 0.08,
        shadowRadius: 24,
        elevation: 8,
        borderWidth: 1,
        borderColor: C.border,
    },
    glassGradient: {
        ...StyleSheet.absoluteFillObject,
    },
    appIcon: {
        width: 125, // Slightly smaller than container to show the glass edge
        height: 125,
    },
    title: {
        fontSize: 38,
        fontWeight: '900', // Pushed back to max weight
        color: C.textHeading, // Slate 900 for absolute contrast
        letterSpacing: 6, // Punchy spacing
        marginBottom: 8,
        fontFamily: 'AvenirNext-Heavy', // User specifically requested this for both iOS and Android
        textTransform: 'uppercase',
    },
    tagline: {
        fontSize: 14,
        fontWeight: '400',
        color: C.textBody,
        letterSpacing: 1,
    },
});
