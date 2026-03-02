import React, { useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Animated, Platform } from 'react-native';
import { Server } from 'lucide-react-native';
import { useServerStatus } from '../context/ServerStatusContext';

export default function ServerWakingOverlay() {
    const { isWaking, statusText } = useServerStatus();
    const translateY = useRef(new Animated.Value(-120)).current;
    const opacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        if (isWaking) {
            Animated.parallel([
                Animated.spring(translateY, { toValue: 0, tension: 50, friction: 8, useNativeDriver: true }),
                Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true })
            ]).start();
        } else {
            Animated.parallel([
                Animated.timing(translateY, { toValue: -120, duration: 400, useNativeDriver: true }),
                Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true })
            ]).start();
        }
    }, [isWaking]);

    return (
        <Animated.View style={[styles.overlay, { opacity, transform: [{ translateY }] }]}>
            <View style={styles.card}>
                <View style={styles.iconCircle}>
                    <Server color="#4B6EF5" size={18} />
                </View>
                <View style={styles.content}>
                    <Text style={styles.title}>{statusText}</Text>
                    <Text style={styles.subtitle}>Render cold start can take ~30s</Text>
                </View>
                <ActivityIndicator size="small" color="#4B6EF5" style={styles.loader} />
            </View>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 60 : 40,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 9999,
        elevation: 10,
        pointerEvents: 'none',
    },
    card: {
        backgroundColor: '#FFFFFF',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 20,
        borderWidth: 1.5,
        borderColor: '#E2E8F0',
        shadowColor: '#4B6EF5',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
        elevation: 12,
        width: '90%',
        maxWidth: 400,
    },
    iconCircle: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#EEF1FD',
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        flex: 1,
        marginLeft: 12,
    },
    loader: {
        marginLeft: 8,
    },
    title: {
        fontSize: 14,
        fontWeight: '800',
        color: '#1A1F36',
    },
    subtitle: {
        fontSize: 11,
        color: '#8892A4',
        fontWeight: '600',
        marginTop: 1,
    }
});
