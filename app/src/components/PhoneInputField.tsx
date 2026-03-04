import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, Animated } from 'react-native';

interface PhoneInputFieldProps {
    value: string;
    onChangeText: (text: string) => void;
    error?: string;
    editable?: boolean;
    autoFocus?: boolean;
    onSubmitEditing?: () => void;
}

export default function PhoneInputField({
    value,
    onChangeText,
    error,
    editable = true,
    autoFocus = false,
    onSubmitEditing,
}: PhoneInputFieldProps) {
    const [isFocused, setIsFocused] = useState(false);
    const borderAnim = useRef(new Animated.Value(0)).current;
    const inputRef = useRef<TextInput>(null);

    useEffect(() => {
        if (!autoFocus || !editable) return;
        // Slight delay gives the bottom sheet animation time to finish before popping keyboard
        const t = setTimeout(() => inputRef.current?.focus(), 400);
        return () => clearTimeout(t);
    }, [autoFocus, editable]);

    useEffect(() => {
        Animated.timing(borderAnim, {
            toValue: isFocused ? 1 : 0,
            duration: 250,
            useNativeDriver: false, // Color interpolation cannot use native driver
        }).start();
    }, [isFocused]);

    const handleChange = (text: string) => {
        const cleaned = text.replace(/[^0-9]/g, '');
        if (cleaned.length <= 10) {
            onChangeText(cleaned);
        }
    };

    const borderColor = error
        ? '#EF4444'
        : borderAnim.interpolate({
            inputRange: [0, 1],
            outputRange: ['#CBD5E1', '#4B6EF5'],
        });

    return (
        <View style={styles.container}>
            <Animated.View
                style={[
                    styles.inputContainer,
                    {
                        borderColor: borderColor as any,
                        borderBottomWidth: isFocused ? 2 : 1.5,
                    }
                ]}
            >
                <Text style={styles.countryCode}>+91</Text>

                <TextInput
                    ref={inputRef}
                    style={styles.input}
                    placeholder="Mobile number"
                    placeholderTextColor="#94A3B8"
                    keyboardType="number-pad"
                    value={value}
                    onChangeText={handleChange}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    editable={editable}
                    maxLength={10}
                    returnKeyType="done"
                    onSubmitEditing={onSubmitEditing}
                    selectionColor="#4B6EF5"
                />
            </Animated.View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
        marginBottom: 8,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 4,
    },
    countryCode: {
        fontSize: 18,
        fontWeight: '600',
        color: '#64748B',
        marginRight: 16,
    },
    input: {
        flex: 1,
        fontSize: 22,
        color: '#0F172A',
        fontWeight: '600',
        letterSpacing: 2.0,
        height: 48,
        padding: 0,
        margin: 0,
    },
    errorText: {
        color: '#EF4444',
        fontSize: 13,
        fontWeight: '500',
        marginTop: 8,
    },
});
