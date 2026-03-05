import React, { useContext, useEffect, useRef, useState, useCallback } from 'react';
import { Alert, AppState, AppStateStatus, Platform, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as ExpoSplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, AuthContext } from './src/context/AuthContext';
import { ToastProvider } from './src/context/ToastContext';
import { ThemeProvider } from './src/context/ThemeContext';
import { ServerStatusProvider } from './src/context/ServerStatusContext';
import { UploadProvider } from './src/context/UploadContext';
import { DownloadProvider } from './src/context/DownloadContext';

import SplashScreen from './src/screens/SplashScreen';
import WelcomeScreen from './src/screens/WelcomeScreen';
import AuthScreen from './src/screens/AuthScreen';
import HomeScreen from './src/screens/HomeScreen';
import FoldersScreen from './src/screens/FoldersScreen';
import FolderFilesScreen from './src/screens/FolderFilesScreen';
import FilePreviewScreen from './src/screens/FilePreviewScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import TrashScreen from './src/screens/TrashScreen';
import StarredScreen from './src/screens/StarredScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AnalyticsScreen from './src/screens/AnalyticsScreen';
import FilesScreen from './src/screens/FilesScreen';
import SharedLinksScreen from './src/screens/SharedLinksScreen';
import SharedSpaceScreen from './src/screens/SharedSpaceScreen';

import UploadProgressOverlay from './src/components/UploadProgressOverlay';
import DownloadProgressOverlay from './src/components/DownloadProgressOverlay';
import ServerWakingOverlay from './src/components/ServerWakingOverlay';
import AppErrorBoundary from './src/components/AppErrorBoundary';
import { logger } from './src/utils/logger';

ExpoSplashScreen.preventAutoHideAsync().catch(() => { });

const Stack = createNativeStackNavigator();
const OTA_LAST_RELOADED_UPDATE_ID_KEY = '@ota_last_reloaded_update_id';
const OTA_LAST_CHECKED_AT_KEY = '@ota_last_checked_at';
const OTA_FOREGROUND_CHECK_INTERVAL_MS = 15 * 60 * 1000;

function RootNavigator() {
    const auth = useContext(AuthContext);
    const isAuthenticated = auth?.isAuthenticated;
    const isLoading = auth?.isLoading;
    const [nativeSplashHidden, setNativeSplashHidden] = useState(false);
    const [animatedSplashDone, setAnimatedSplashDone] = useState(false);

    useEffect(() => {
        if (!isLoading && !nativeSplashHidden) {
            ExpoSplashScreen.hideAsync().catch(() => { });
            setNativeSplashHidden(true);
        }
    }, [isLoading, nativeSplashHidden]);

    if (!nativeSplashHidden) return null;
    if (!animatedSplashDone) return <SplashScreen onFinish={() => setAnimatedSplashDone(true)} />;

    return (
        <NavigationContainer>
            <View style={{ flex: 1 }}>
                <Stack.Navigator id="root" screenOptions={{ headerShown: false, animation: 'fade' }}>
                    {!isAuthenticated ? (
                        <>
                            <Stack.Screen name="Welcome" component={WelcomeScreen} />
                            <Stack.Screen name="Auth" component={AuthScreen} />
                        </>
                    ) : (
                        <>
                            <Stack.Screen name="Home" component={HomeScreen} />
                            <Stack.Screen name="Folders" component={FoldersScreen} />
                            <Stack.Screen name="FolderFiles" component={FolderFilesScreen} />
                            <Stack.Screen name="FilePreview" component={FilePreviewScreen} />
                            <Stack.Screen name="Profile" component={ProfileScreen} />
                            <Stack.Screen name="Trash" component={TrashScreen} />
                            <Stack.Screen name="Starred" component={StarredScreen} />
                            <Stack.Screen name="Settings" component={SettingsScreen} />
                            <Stack.Screen name="Analytics" component={AnalyticsScreen} />
                            <Stack.Screen name="Files" component={FilesScreen} />
                            <Stack.Screen name="SharedLinks" component={SharedLinksScreen} />
                            <Stack.Screen name="SharedSpace" component={SharedSpaceScreen} />
                        </>
                    )}
                </Stack.Navigator>
                <UploadProgressOverlay />
                <DownloadProgressOverlay />
                <ServerWakingOverlay />
            </View>
        </NavigationContainer>
    );
}

export default function App() {
    const hasCheckedOtaRef = useRef(false);
    const appStateRef = useRef<AppStateStatus>(AppState.currentState);

    const checkForOtaUpdate = useCallback(async (reason: 'launch' | 'foreground') => {
        if (__DEV__) return;

        if (!Updates.isEnabled) {
            logger.warn('frontend.ota', 'OTA disabled for this build', {
                reason,
                channel: Updates.channel ?? null,
                runtimeVersion: Updates.runtimeVersion ?? null,
                updateId: Updates.updateId ?? null,
            });
            return;
        }

        try {
            const now = Date.now();
            if (reason === 'foreground') {
                const lastCheckedRaw = await AsyncStorage.getItem(OTA_LAST_CHECKED_AT_KEY);
                const lastChecked = Number(lastCheckedRaw || '0');
                if (Number.isFinite(lastChecked) && now - lastChecked < OTA_FOREGROUND_CHECK_INTERVAL_MS) {
                    return;
                }
            }
            await AsyncStorage.setItem(OTA_LAST_CHECKED_AT_KEY, String(now));

            logger.info('frontend.ota', 'Checking OTA updates', {
                reason,
                channel: Updates.channel ?? null,
                runtimeVersion: Updates.runtimeVersion ?? null,
                updateId: Updates.updateId ?? null,
            });

            const update = await Updates.checkForUpdateAsync();
            if (!update.isAvailable) return;

            const fetchResult = await Updates.fetchUpdateAsync();
            if (!fetchResult.isNew) return;

            const nextUpdateId = (fetchResult.manifest as { id?: string } | undefined)?.id;
            const lastReloadedUpdateId = await AsyncStorage.getItem(OTA_LAST_RELOADED_UPDATE_ID_KEY);
            if (nextUpdateId && nextUpdateId === lastReloadedUpdateId) {
                logger.warn('frontend.ota', 'Skipping reload to prevent update loop', {
                    reason,
                    updateId: nextUpdateId,
                });
                return;
            }

            Alert.alert(
                'Update Available',
                'A new update is ready. Restart now to apply it.',
                [
                    { text: 'Later', style: 'cancel' },
                    {
                        text: 'Restart',
                        onPress: async () => {
                            try {
                                if (nextUpdateId) {
                                    await AsyncStorage.setItem(OTA_LAST_RELOADED_UPDATE_ID_KEY, nextUpdateId);
                                }
                                await Updates.reloadAsync();
                            } catch (error: any) {
                                logger.error('frontend.ota', 'Failed to reload into OTA update', {
                                    reason,
                                    message: error?.message,
                                    updateId: nextUpdateId,
                                });
                            }
                        },
                    },
                ],
                { cancelable: true }
            );
        } catch (error: any) {
            logger.warn('frontend.ota', 'OTA check failed', {
                reason,
                message: error?.message,
                channel: Updates.channel ?? null,
                runtimeVersion: Updates.runtimeVersion ?? null,
            });
        }
    }, []);

    useEffect(() => {
        const globalAny = global as any;
        const ErrorUtilsRef = globalAny?.ErrorUtils;
        const existingGlobalHandler = ErrorUtilsRef?.getGlobalHandler?.();
        if (ErrorUtilsRef?.setGlobalHandler) {
            ErrorUtilsRef.setGlobalHandler((error: Error, isFatal?: boolean) => {
                logger.error('frontend.global_error', 'Global JS error', {
                    name: error?.name,
                    message: error?.message,
                    stack: error?.stack,
                    isFatal: !!isFatal,
                });
                if (existingGlobalHandler) existingGlobalHandler(error, isFatal);
            });
        }

        if (Platform.OS === 'android') {
            Notifications.setNotificationChannelAsync('upload_channel', {
                name: 'File Transfers',
                importance: Notifications.AndroidImportance.LOW,
                description: 'Shows file upload and download progress',
                enableVibrate: false,
                showBadge: false,
            });
        }

        Notifications.requestPermissionsAsync().then(({ status }) => {
            if (status !== 'granted') console.warn('[Notifications] Permission not granted');
        });

        Notifications.setNotificationHandler({
            handleNotification: async () => ({
                shouldShowAlert: false,
                shouldShowBanner: false,
                shouldShowList: true,
                shouldPlaySound: false,
                shouldSetBadge: false,
            }),
        });

        return () => {
            if (ErrorUtilsRef?.setGlobalHandler && existingGlobalHandler) {
                ErrorUtilsRef.setGlobalHandler(existingGlobalHandler);
            }
        };
    }, []);

    useEffect(() => {
        if (hasCheckedOtaRef.current) return;
        hasCheckedOtaRef.current = true;
        void checkForOtaUpdate('launch');
    }, [checkForOtaUpdate]);

    useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextState) => {
            const wasBackgrounded = appStateRef.current === 'background' || appStateRef.current === 'inactive';
            appStateRef.current = nextState;
            if (wasBackgrounded && nextState === 'active') {
                void checkForOtaUpdate('foreground');
            }
        });
        return () => subscription.remove();
    }, [checkForOtaUpdate]);

    return (
        <AppErrorBoundary>
            <GestureHandlerRootView style={{ flex: 1 }}>
                <SafeAreaProvider>
                    <ThemeProvider>
                        <ServerStatusProvider>
                            <UploadProvider>
                                <DownloadProvider>
                                    <AuthProvider>
                                        <ToastProvider>
                                            <RootNavigator />
                                        </ToastProvider>
                                    </AuthProvider>
                                </DownloadProvider>
                            </UploadProvider>
                        </ServerStatusProvider>
                    </ThemeProvider>
                </SafeAreaProvider>
            </GestureHandlerRootView>
        </AppErrorBoundary>
    );
}
