/**
 * App.tsx — Production entry point with proper splash screen handling
 *
 * ✅ expo-splash-screen: preventAutoHideAsync() before render
 * ✅ Auth bootstrap runs DURING native splash (not after)
 * ✅ Native splash hides only after auth is ready
 * ✅ Custom animated splash plays AFTER native splash hides
 * ✅ No intermediate ActivityIndicator screen
 * ✅ No flicker between native → JS splash → app
 */

import React, { useContext, useState, useEffect, useCallback } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Alert, Platform, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as ExpoSplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, AuthContext } from './src/context/AuthContext';
import { ToastProvider } from './src/context/ToastContext';
import { ThemeProvider } from './src/context/ThemeContext';

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

import { ServerStatusProvider } from './src/context/ServerStatusContext';
import { UploadProvider } from './src/context/UploadContext';
import { DownloadProvider } from './src/context/DownloadContext';

// ─── CRITICAL: Keep native splash visible until we're ready ──────────────────
// This MUST run at module level (before any component renders)
ExpoSplashScreen.preventAutoHideAsync().catch(() => {
    // Silently catch — on web or older SDKs this might not exist
});

const Stack = createNativeStackNavigator();
const OTA_LAST_RELOADED_UPDATE_ID_KEY = '@ota_last_reloaded_update_id';

// ─── Root Navigator ──────────────────────────────────────────────────────────

function RootNavigator() {
    const auth = useContext(AuthContext);
    const isAuthenticated = auth?.isAuthenticated;
    const isLoading = auth?.isLoading;

    // Two-phase splash:
    // Phase 1: Native splash (visible while auth bootstraps)
    // Phase 2: Animated JS splash (plays after auth is ready)
    const [nativeSplashHidden, setNativeSplashHidden] = useState(false);
    const [animatedSplashDone, setAnimatedSplashDone] = useState(false);

    // Once auth is done loading, hide the native splash & show animated splash
    useEffect(() => {
        if (!isLoading && !nativeSplashHidden) {
            // Auth is ready — hide native splash, start animated splash
            ExpoSplashScreen.hideAsync().catch(() => { });
            setNativeSplashHidden(true);
        }
    }, [isLoading, nativeSplashHidden]);

    // Phase 1: While auth is loading, native splash is still visible
    // We render nothing (native splash covers the screen)
    if (!nativeSplashHidden) {
        return null;
    }

    // Phase 2: Show animated JS splash
    if (!animatedSplashDone) {
        return <SplashScreen onFinish={() => setAnimatedSplashDone(true)} />;
    }

    // Phase 3: App is ready — show navigation
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

// ─── App Entry Point ─────────────────────────────────────────────────────────

export default function App() {
    const hasCheckedOtaRef = React.useRef(false);

    useEffect(() => {
        // Global error handler
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
                if (existingGlobalHandler) {
                    existingGlobalHandler(error, isFatal);
                }
            });
        }

        // Set up Android notification channel for file transfers
        if (Platform.OS === 'android') {
            Notifications.setNotificationChannelAsync('upload_channel', {
                name: 'File Transfers',
                importance: Notifications.AndroidImportance.LOW,
                description: 'Shows file upload and download progress',
                enableVibrate: false,
                showBadge: false,
            });
        }

        // Request notification permissions
        Notifications.requestPermissionsAsync().then(({ status }) => {
            if (status !== 'granted') {
                console.warn('[Notifications] Permission not granted');
            }
        });

        // Configure foreground notification behavior
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
        // Run only once per app launch and only where expo-updates is supported.
        if (hasCheckedOtaRef.current) return;
        hasCheckedOtaRef.current = true;

        if (__DEV__ || !Updates.isEnabled) {
            return;
        }

        const checkForOtaUpdate = async () => {
            try {
                const update = await Updates.checkForUpdateAsync();
                if (!update.isAvailable) return;

                const fetchResult = await Updates.fetchUpdateAsync();
                if (!fetchResult.isNew) return;

                const nextUpdateId = (fetchResult.manifest as { id?: string } | undefined)?.id;
                const lastReloadedUpdateId = await AsyncStorage.getItem(OTA_LAST_RELOADED_UPDATE_ID_KEY);
                if (nextUpdateId && nextUpdateId === lastReloadedUpdateId) {
                    logger.warn('frontend.ota', 'Skipping reload to prevent update loop', {
                        updateId: nextUpdateId,
                    });
                    return;
                }

                Alert.alert(
                    'Update Available',
                    'Update available — Restart app to apply update.',
                    [
                        {
                            text: 'Later',
                            style: 'cancel',
                        },
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
                    message: error?.message,
                    channel: Updates.channel ?? null,
                });
            }
        };

        void checkForOtaUpdate();
    }, []);

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
