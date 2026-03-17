import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
    Easing,
} from 'react-native-reanimated';

export default function PreviewSkeleton() {
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

    return <Animated.View style={[styles.base, shimmerStyle]} />;
}

const styles = StyleSheet.create({
    base: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: '#CBD5E1',
        borderRadius: 16,
    },
});
