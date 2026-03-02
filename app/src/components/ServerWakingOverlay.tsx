import React, { useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Animated } from 'react-native';
import { Server } from 'lucide-react-native';
import { useServerStatusStore } from '../context/ServerStatusStore';

export default function ServerWakingOverlay() {
    const isWaking = useServerStatusStore((state) => state.isWaking);
    const translateY = useRef(new Animated.Value(-100)).current;
    const opacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (isWaking) {
            Animated.parallel([
                Animated.spring(translateY, { toValue: 0, tension: 60, friction: 8, useNativeDriver: true }),
                Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true })
            ]).start();
        } else {
            Animated.parallel([
                Animated.timing(translateY, { toValue: -100, duration: 400, useNativeDriver: true }),
                Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true })
            ]).start();
        }
    }, [isWaking]);

    return (
        <Animated.View style={[styles.overlay, { opacity, transform: [{ translateY }] }]}>
            <View style={styles.card}>
                <Server color="#4B6EF5" size={24} />
                <ActivityIndicator size="small" color="#4B6EF5" style={styles.loader} />
                <View>
                    <Text style={styles.title}>Waking Server...</Text>
                    <Text style={styles.subtitle}>First request takes ~30s on free tier</Text>
                </View>
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        top: 50,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 9999,
        elevation: 10,
        pointerEvents: 'none',
    },
    card: {
        backgroundColor: '#EEF1FD',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 14,
        borderRadius: 100,
        borderWidth: 1,
        borderColor: '#C6D4F9',
        shadowColor: '#4B6EF5',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.25,
        shadowRadius: 16,
        elevation: 8,
    },
    loader: {
        marginHorizontal: 12,
    },
    title: {
        fontSize: 14,
        fontWeight: '700',
        color: '#1E293B',
    },
    subtitle: {
        fontSize: 12,
        color: '#4B6EF5',
        fontWeight: '500',
    }
});
