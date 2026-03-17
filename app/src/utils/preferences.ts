import AsyncStorage from '@react-native-async-storage/async-storage';

export const NOTIFICATIONS_ENABLED_KEY = '@preferences_notifications_enabled';
const LEGACY_NOTIFICATIONS_ENABLED_KEY = 'notificationsEnabled';

let notificationsCache: boolean | null = null;

export const getNotificationsEnabled = async () => {
    if (notificationsCache !== null) {
        return notificationsCache;
    }

    try {
        const [currentValue, legacyValue] = await Promise.all([
            AsyncStorage.getItem(NOTIFICATIONS_ENABLED_KEY),
            AsyncStorage.getItem(LEGACY_NOTIFICATIONS_ENABLED_KEY),
        ]);
        const rawValue = currentValue ?? legacyValue;
        notificationsCache = rawValue === null ? true : rawValue === 'true';

        if (currentValue === null && legacyValue !== null) {
            await AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, legacyValue);
        }
        return notificationsCache;
    } catch {
        notificationsCache = true;
        return true;
    }
};

export const setNotificationsEnabled = async (value: boolean) => {
    notificationsCache = value;
    await Promise.all([
        AsyncStorage.setItem(NOTIFICATIONS_ENABLED_KEY, String(value)),
        AsyncStorage.setItem(LEGACY_NOTIFICATIONS_ENABLED_KEY, String(value)),
    ]);
    return value;
};