/**
 * Secure Storage Utility
 * 
 * Uses expo-secure-store on native platforms for encrypted token storage.
 * Falls back to AsyncStorage on web (where SecureStore is not available).
 * 
 * SECURITY NOTE: On native iOS/Android, tokens are stored in the device's
 * secure enclave/keychain. On web, they are stored in localStorage which
 * is not encrypted but is the best available option for web apps.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Dynamically import SecureStore only on native platforms
let SecureStore: typeof import('expo-secure-store') | null = null;

if (Platform.OS !== 'web') {
    // SecureStore is not available on web
    SecureStore = require('expo-secure-store');
}

const SECURE_STORE_AVAILABLE = Platform.OS !== 'web' && SecureStore !== null;

/**
 * Store a value securely.
 * On native: uses device keychain/keystore
 * On web: uses AsyncStorage (not encrypted, but best available)
 */
export async function setSecureValue(key: string, value: string): Promise<void> {
    if (SECURE_STORE_AVAILABLE && SecureStore) {
        await SecureStore.setItemAsync(key, value, {
            keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
        });
    } else {
        await AsyncStorage.setItem(key, value);
    }
}

/**
 * Retrieve a securely stored value.
 */
export async function getSecureValue(key: string): Promise<string | null> {
    if (SECURE_STORE_AVAILABLE && SecureStore) {
        return await SecureStore.getItemAsync(key);
    } else {
        return await AsyncStorage.getItem(key);
    }
}

/**
 * Delete a securely stored value.
 */
export async function deleteSecureValue(key: string): Promise<void> {
    if (SECURE_STORE_AVAILABLE && SecureStore) {
        await SecureStore.deleteItemAsync(key);
    } else {
        await AsyncStorage.removeItem(key);
    }
}

/**
 * Check if SecureStore is being used (for logging/debugging)
 */
export function isUsingSecureStore(): boolean {
    return SECURE_STORE_AVAILABLE;
}

// Token keys
export const SECURE_KEYS = {
    JWT_TOKEN: 'jwtToken',
    REFRESH_TOKEN: 'refreshToken',
} as const;
