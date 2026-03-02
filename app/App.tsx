import React, { useContext, useState, useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, Platform, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

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
import UploadProgressOverlay from './src/components/UploadProgressOverlay';
import ServerWakingOverlay from './src/components/ServerWakingOverlay';
import AppErrorBoundary from './src/components/AppErrorBoundary';
import { logger } from './src/utils/logger';

import { ServerStatusProvider } from './src/context/ServerStatusContext';
import { UploadProvider } from './src/context/UploadContext';

const Stack = createNativeStackNavigator();

function RootNavigator() {
    const auth = useContext(AuthContext);
    const isAuthenticated = auth?.isAuthenticated;
    const isLoading = auth?.isLoading;

    const [splashDone, setSplashDone] = useState(false);

    if (!splashDone) {
        return <SplashScreen onFinish={() => setSplashDone(true)} />;
    }

    if (isLoading) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0A0E1F' }}>
                <ActivityIndicator size="large" color="#4B6EF5" />
            </View>
        );
    }

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
                        </>
                    )}
                </Stack.Navigator>
                <UploadProgressOverlay />
                <ServerWakingOverlay />
            </View>
        </NavigationContainer>
    );
}

export default function App() {
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
                if (existingGlobalHandler) {
                    existingGlobalHandler(error, isFatal);
                }
            });
        }

        // Set up Android notification channel for upload progress
        // (required on Android 8+ for notifications to appear)
        if (Platform.OS === 'android') {
            Notifications.setNotificationChannelAsync('upload_channel', {
                name: 'File Uploads',
                importance: Notifications.AndroidImportance.LOW, // LOW = no sound, non-intrusive
                description: 'Shows file upload progress',
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

        // Configure how notifications appear when app is in foreground
        Notifications.setNotificationHandler({
            handleNotification: async () => ({
                shouldShowAlert: false,
                shouldShowBanner: false, // SDK 55 required
                shouldShowList: true,    // SDK 55 required — appears in notification drawer
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

    return (
        <AppErrorBoundary>
            <GestureHandlerRootView style={{ flex: 1 }}>
                <ThemeProvider>
                    <ServerStatusProvider>
                        <UploadProvider>
                            <AuthProvider>
                                <ToastProvider>
                                    <RootNavigator />
                                </ToastProvider>
                            </AuthProvider>
                        </UploadProvider>
                    </ServerStatusProvider>
                </ThemeProvider>
            </GestureHandlerRootView>
        </AppErrorBoundary>
    );
}
