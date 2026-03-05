import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';

interface PasswordGateProps {
    onSubmit: (password: string) => Promise<void>;
}

export default function PasswordGateComponent({ onSubmit }: PasswordGateProps) {
    const { theme } = useTheme();
    const [password, setPassword] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    const submit = useCallback(async () => {
        const value = password.trim();
        if (!value || isSubmitting) return;
        setIsSubmitting(true);
        setError('');
        try {
            await onSubmit(value);
        } catch (err: any) {
            setError(err?.message || 'Invalid password');
        } finally {
            setIsSubmitting(false);
        }
    }, [isSubmitting, onSubmit, password]);

    return (
        <View style={[styles.container, { backgroundColor: theme.colors.card }]}>
            <Text style={[styles.title, { color: theme.colors.textHeading }]}>Password Protected</Text>
            <Text style={[styles.subtitle, { color: theme.colors.textBody }]}>Enter password to access this shared space.</Text>
            <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                placeholder="Enter password"
                placeholderTextColor={theme.colors.textBody}
                style={[styles.input, { borderColor: theme.colors.border, color: theme.colors.textHeading }]}
            />
            {!!error && <Text style={styles.error}>{error}</Text>}
            <TouchableOpacity
                style={[styles.button, { backgroundColor: theme.colors.primary }]}
                onPress={() => void submit()}
                disabled={isSubmitting}
            >
                {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Unlock</Text>}
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        borderRadius: 16,
        padding: 16,
        gap: 10,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
    },
    subtitle: {
        fontSize: 13,
    },
    input: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
    },
    error: {
        color: '#EF4444',
        fontSize: 12,
        fontWeight: '600',
    },
    button: {
        height: 44,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonText: {
        color: '#fff',
        fontWeight: '700',
        fontSize: 15,
    },
});
