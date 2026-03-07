import React, { useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Animated, Pressable } from 'react-native';
import { ArrowRight } from 'lucide-react-native';

interface PrimaryButtonProps {
    onPress: () => void;
    disabled?: boolean;
    loading?: boolean;
    label: string;
}

// Fix #9: React.memo
export default React.memo(function PrimaryButton({ onPress, disabled, loading, label }: PrimaryButtonProps) {
    const scaleAnim = useRef(new Animated.Value(1)).current;

    const onPressIn = () => {
        Animated.spring(scaleAnim, {
            toValue: 0.96,
            useNativeDriver: true,
            speed: 50,
            bounciness: 4,
        }).start();
    };

    const onPressOut = () => {
        Animated.spring(scaleAnim, {
            toValue: 1,
            useNativeDriver: true,
            speed: 20,
            bounciness: 6,
        }).start();
    };

    const isDisabled = disabled || loading;

    return (
        <Pressable
            onPress={onPress}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            disabled={isDisabled}
        >
            <Animated.View
                style={[
                    styles.ctaBtn,
                    isDisabled && styles.ctaDisabled,
                    { transform: [{ scale: scaleAnim }] },
                ]}
            >
                {loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                ) : (
                    <>
                        <Text style={styles.ctaText}>{label}</Text>
                        <View style={styles.ctaArrow}>
                            <ArrowRight color="#fff" size={18} strokeWidth={2.5} />
                        </View>
                    </>
                )}
            </Animated.View>
        </Pressable>
    );
});

const styles = StyleSheet.create({
    ctaBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        backgroundColor: '#4B6EF5',
        borderRadius: 16,
        height: 52,
        width: '100%',
        shadowColor: '#3B5DE7',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 14,
        elevation: 6,
    },
    ctaDisabled: {
        backgroundColor: '#CBD5E1',
        shadowColor: '#CBD5E1',
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 0,
    },
    ctaText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#fff',
        letterSpacing: 0.2
    },
    ctaArrow: {
        width: 28, height: 28, borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.25)',
        justifyContent: 'center', alignItems: 'center',
    },
});
