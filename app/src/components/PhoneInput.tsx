import React from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { Phone } from 'lucide-react-native';

interface PhoneInputProps {
    value: string;
    onChangeText: (text: string) => void;
    error?: string;
    editable?: boolean;
}

const PhoneInput: React.FC<PhoneInputProps> = ({ value, onChangeText, error, editable = true }) => {
    const handleChange = (text: string) => {
        // Only allow 10 digits
        const cleaned = text.replace(/[^0-9]/g, '');
        if (cleaned.length <= 10) {
            onChangeText(cleaned);
        }
    };

    return (
        <View style={styles.container}>
            <View style={[styles.inputContainer, error ? styles.inputError : null]}>
                <View style={styles.countryPicker}>
                    <Text style={styles.flag}>🇮🇳</Text>
                    <Text style={styles.countryCode}>+91</Text>
                </View>
                <View style={styles.divider} />
                <TextInput
                    style={styles.input}
                    placeholder="9876543210"
                    placeholderTextColor="#B0BAC9"
                    keyboardType="phone-pad"
                    value={value}
                    onChangeText={handleChange}
                    editable={editable}
                    maxLength={10}
                />
                <View style={styles.iconBox}>
                    <Phone color="#4B6EF5" size={18} />
                </View>
            </View>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            <Text style={styles.hint}>Enter your 10-digit mobile number</Text>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        width: '100%',
        gap: 6,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#F4F6FB',
        borderRadius: 16,
        borderWidth: 1.5,
        borderColor: '#EAEDF3',
        height: 60,
        paddingHorizontal: 12,
    },
    inputError: {
        borderColor: '#EF4444',
    },
    countryPicker: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingRight: 8,
    },
    flag: {
        fontSize: 20,
    },
    countryCode: {
        fontSize: 16,
        fontWeight: '600',
        color: '#1A1F36',
    },
    divider: {
        width: 1,
        height: 24,
        backgroundColor: '#E2E8F0',
        marginHorizontal: 8,
    },
    input: {
        flex: 1,
        fontSize: 18,
        color: '#1A1F36',
        fontWeight: '600',
        letterSpacing: 1,
    },
    iconBox: {
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: '#EEF1FD',
        justifyContent: 'center',
        alignItems: 'center',
    },
    errorText: {
        color: '#EF4444',
        fontSize: 12,
        fontWeight: '500',
        marginLeft: 4,
    },
    hint: {
        color: '#8892A4',
        fontSize: 12,
        marginLeft: 4,
    }
});

export default PhoneInput;
