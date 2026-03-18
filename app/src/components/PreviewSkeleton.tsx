import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
    Easing,
} from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';

export default function PreviewSkeleton() {
    const { theme } = useTheme();
    const shimmer = useSharedValue(0.45);

    useEffect(() => {
        shimmer.value = withRepeat(
            withTiming(0.95, { duration: 850, easing: Easing.inOut(Easing.quad) }),
            -1,
            true
        );
    }, [shimmer]);

    const shimmerStyle = useAnimatedStyle(() => ({
        opacity: shimmer.value,
    }));

    return <Animated.View style={[styles.base, { backgroundColor: theme.colors.surfaceMuted }, shimmerStyle]} />;
}

const styles = StyleSheet.create({
    base: {
        ...StyleSheet.absoluteFillObject,
        borderRadius: 12,
    },
});
