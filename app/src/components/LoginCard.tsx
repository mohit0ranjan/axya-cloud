import React, { useEffect, useRef } from 'react';
import { View, ScrollView, StyleSheet, Animated } from 'react-native';

interface LoginCardProps {
    children: React.ReactNode;
    keyboardVisible: boolean;
}

// Fix #3: Added ScrollView for short devices + Fix #9: React.memo
export default React.memo(function LoginCard({ children, keyboardVisible }: LoginCardProps) {
    const sheetY = useRef(new Animated.Value(200)).current;
    const sheetOpacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.spring(sheetY, {
                toValue: 0,
                tension: 44,
                friction: 9,
                delay: 220,
                useNativeDriver: true
            }),
            Animated.timing(sheetOpacity, {
                toValue: 1,
                duration: 420,
                delay: 220,
                useNativeDriver: true
            }),
        ]).start();
    }, []);

    return (
        <Animated.View style={[
            styles.sheet,
            {
                opacity: sheetOpacity,
                transform: [{ translateY: sheetY }],
                marginBottom: keyboardVisible ? 16 : 0,
            }
        ]}>
            <View style={styles.sheetHandle} />
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                bounces={false}
                keyboardDismissMode="on-drag"
            >
                {children}
            </ScrollView>
        </Animated.View>
    );
});

const styles = StyleSheet.create({
    sheet: {
        width: '100%',
        backgroundColor: '#fff',
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        paddingHorizontal: 28,
        paddingTop: 18,
        paddingBottom: 32,
        alignItems: 'center',
        shadowColor: '#1A1F36',
        shadowOffset: { width: 0, height: -10 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
        elevation: 20,
        maxHeight: '75%', // Prevent card from consuming entire screen on short devices
    },
    scrollView: {
        width: '100%',
    },
    scrollContent: {
        alignItems: 'center',
        gap: 20,
        paddingBottom: 4,
    },
    sheetHandle: {
        width: 48,
        height: 5,
        borderRadius: 3,
        backgroundColor: '#E2E8F0',
        marginBottom: 10,
    },
});
