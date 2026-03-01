import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';

interface Props {
    size?: number;
    showText?: boolean;
    textColor?: string;
    dark?: boolean;
}

export default function AxyaLogo({ size = 40, showText = true, textColor, dark = false }: Props) {
    const color = textColor || (dark ? '#fff' : '#1A1F36');
    return (
        <View style={styles.row}>
            <Image
                source={require('../../assets/axya_logo.png')}
                style={{ width: size, height: size, borderRadius: size * 0.25 }}
                resizeMode="contain"
            />
            {showText && (
                <Text style={[styles.text, { fontSize: size * 0.65, color }]}>
                    Axya
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    text: {
        fontWeight: '800',
        letterSpacing: -0.8,
    },
});
