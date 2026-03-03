import React, { useState, useRef, useCallback } from 'react';
import { View, Text, TextInput, StyleSheet, Animated, Platform } from 'react-native';
import { Phone } from 'lucide-react-native';

interface PhoneInputProps {
    value: string;
    onChangeText: (text: string) => void;
    error?: string;
    editable?: boolean;
}

const PhoneInput: React.FC<PhoneInputProps> = ({ value, onChangeText, error, editable = true }) => {
    const [isFocused, setIsFocused] = useState(false);
    const borderAnim = useRef(new Animated.Value(0)).current;

    const handleFocus = useCallback(() => {
        setIsFocused(true);
        Animated.timing(borderAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: false,
        }).start();
    }, []);

    const handleBlur = useCallback(() => {
        setIsFocused(false);
        Animated.timing(borderAnim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: false,
        }).start();
    }, []);

    const handleChange = (text: string) => {
        // Only allow 10 digits
        const cleaned = text.replace(/[^0-9]/g, '');
        if (cleaned.length <= 10) {
            onChangeText(cleaned);
        }
    };

    // Animated border color
    const borderColor = error
        ? '#EF4444'
        : borderAnim.interpolate({
            inputRange: [0, 1],
            outputRange: ['#E2E8F0', '#4B6EF5'],
        });

    const bgColor = error
        ? '#FEF2F2'
        : borderAnim.interpolate({
            inputRange: [0, 1],
            outputRange: ['#F4F6FB', '#F0F3FF'],
        });

    return (
        <View style={styles.container}>
            <Animated.View
                style={[
                    styles.inputContainer,
                    {
                        borderColor: borderColor as any,
                        backgroundColor: bgColor as any,
                    },
                ]}
            >
                <View style={styles.countryPicker}>
                    <Text style={styles.flag}>🇮🇳</Text>
                    <Text style={styles.countryCode}>+91</Text>
                </View>
                <View style={[
                    styles.divider,
                    isFocused && !error && { backgroundColor: '#4B6EF5', opacity: 0.3 },
                    error ? { backgroundColor: '#EF4444', opacity: 0.3 } : {},
                ]} />
                <TextInput
                    style={styles.input}
                    placeholder="98765 43210"
                    placeholderTextColor="#94A3B8"
                    keyboardType="phone-pad"
                    value={value}
                    onChangeText={handleChange}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    editable={editable}
                    maxLength={10}
                />
                <View style={[
                    styles.iconBox,
                    isFocused && !error && { backgroundColor: '#4B6EF5', },
                    error ? { backgroundColor: '#EF4444' } : {},
                ]}>
                    <Phone color={isFocused || error ? '#fff' : '#4B6EF5'} size={16} />
                </View>
            </Animated.View>
            {error ? (
                <Text style={styles.errorText}>⚠ {error}</Text>
            ) : (
                <Text style={styles.hint}>Enter your 10-digit mobile number</Text>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        width: '100%',
        gap: 8,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 16,
        borderWidth: 2,
        height: 62,
        paddingHorizontal: 14,
    },
    countryPicker: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingRight: 10,
    },
    flag: {
        fontSize: 22,
    },
    countryCode: {
        fontSize: 17,
        fontWeight: '700',
        color: '#1A1F36',
        letterSpacing: 0.5,
    },
    divider: {
        width: 1.5,
        height: 28,
        backgroundColor: '#E2E8F0',
        marginHorizontal: 10,
    },
    input: {
        flex: 1,
        fontSize: 18,
        color: '#1A1F36',
        fontWeight: '600',
        letterSpacing: 1.5,
        paddingVertical: Platform.OS === 'ios' ? 0 : 0,
        // Ensures vertical centering on both platforms
        textAlignVertical: 'center',
    },
    iconBox: {
        width: 36,
        height: 36,
        borderRadius: 12,
        backgroundColor: '#EEF1FD',
        justifyContent: 'center',
        alignItems: 'center',
    },
    errorText: {
        color: '#DC2626',
        fontSize: 13,
        fontWeight: '600',
        marginLeft: 4,
    },
    hint: {
        color: '#64748B',
        fontSize: 13,
        fontWeight: '500',
        marginLeft: 4,
    }
});

export default PhoneInput;
