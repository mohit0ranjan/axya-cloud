import React, { useContext, useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { NavigationContainer, LinkingOptions } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, AuthContext } from './src/context/AuthContext';
import { ToastProvider } from './src/context/ToastContext';
import { ThemeProvider } from './src/context/ThemeContext';
import { ServerStatusProvider } from './src/context/ServerStatusContext';
import { UploadProvider } from './src/context/UploadContext';
import { DownloadProvider } from './src/context/DownloadContext';

import WelcomeScreen from './src/screens/WelcomeScreen';
import AuthScreen from './src/screens/AuthScreen';
import FolderFilesScreen from './src/screens/FolderFilesScreen';
import FilePreviewScreen from './src/screens/FilePreviewScreen';
import TrashScreen from './src/screens/TrashScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import AnalyticsScreen from './src/screens/AnalyticsScreen';
import FilesScreen from './src/screens/FilesScreen';
import SharedLinksScreen from './src/screens/SharedLinksScreen';
import SharedLinkDetailScreen from './src/screens/SharedLinkDetailScreen';
import MainTabs from './src/navigation/MainTabs';
import AnimatedSplashScreen from './src/screens/AnimatedSplashScreen';

import UploadProgressOverlay from './src/components/UploadProgressOverlay';
import DownloadProgressOverlay from './src/components/DownloadProgressOverlay';
import ServerWakingOverlay from './src/components/ServerWakingOverlay';
import AppErrorBoundary from './src/components/AppErrorBoundary';
import { logger } from './src/utils/logger';

ExpoSplashScreen.preventAutoHideAsync().catch(() => { });

const Stack = createNativeStackNavigator();

const linkingPrefixes = [
    'axya://',
    'https://axyzcloud.com',
    'https://axya-web.onrender.com',
];

const getLinking = (isAuthenticated: boolean): LinkingOptions<any> => ({
    prefixes: linkingPrefixes,
    config: {
        screens: {},
    },
});

function RootNavigator() {
    const auth = useContext(AuthContext);
    const isAuthenticated = auth?.isAuthenticated;
    const isLoading = auth?.isLoading;
    const linking = getLinking(Boolean(isAuthenticated));
    const [isSplashAnimationDone, setIsSplashAnimationDone] = useState(false);

    return (
        <NavigationContainer linking={linking}>
            <View style={{ flex: 1 }}>
                <Stack.Navigator
                    id="root"
                    initialRouteName={isAuthenticated ? 'MainTabs' : 'Welcome'}
                    screenOptions={{ headerShown: false, animation: 'fade' }}
                >
                    {!isAuthenticated ? (
                        <>
                            <Stack.Screen name="Welcome" component={WelcomeScreen} />
                            <Stack.Screen name="Auth" component={AuthScreen} />
                        </>
                    ) : (
                        <>
                            <Stack.Screen name="MainTabs" component={MainTabs} />
                            <Stack.Screen name="FolderFiles" component={FolderFilesScreen} />
                            <Stack.Screen name="FilePreview" component={FilePreviewScreen} />
                            <Stack.Screen name="Trash" component={TrashScreen} />
                            <Stack.Screen name="Settings" component={SettingsScreen} />
                            <Stack.Screen name="Analytics" component={AnalyticsScreen} />
                            <Stack.Screen name="Files" component={FilesScreen} />
                            <Stack.Screen name="SharedLinks" component={SharedLinksScreen} />
                            <Stack.Screen name="SharedLinkDetail" component={SharedLinkDetailScreen} />
                        </>
                    )}
                </Stack.Navigator>
                <UploadProgressOverlay />
                <DownloadProgressOverlay />
                <ServerWakingOverlay />

                {(!isSplashAnimationDone || !!isLoading) && (
                    <AnimatedSplashScreen
                        onAnimationComplete={() => setIsSplashAnimationDone(true)}
                        isAuthLoading={!!isLoading}
                    />
                )}
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
