import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, View, StatusBar, Animated, Easing } from 'react-native';
import { NavigationContainer, LinkingOptions, DefaultTheme as NavigationDefaultTheme, DarkTheme as NavigationDarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// Ignore React 18/19 specific warning originating from react-native-web passing standard React Native props to valid DOM elements
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('Received false for a non-boolean attribute collapsable')) {
        return;
    }
    originalConsoleError.apply(console, args);
};

import { AuthProvider, AuthContext } from './src/context/AuthContext';
import { ToastProvider } from './src/context/ToastContext';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { ServerStatusProvider } from './src/context/ServerStatusContext';
import { UploadProvider } from './src/context/UploadContext';
import { DownloadProvider } from './src/context/DownloadContext';

import WelcomeScreen from './src/screens/WelcomeScreen';
import AuthScreen from './src/screens/AuthScreen';
import FolderFilesScreen from './src/screens/FolderFilesScreen';
import FilePreviewScreen from './src/screens/FilePreviewScreen';
import TrashScreen from './src/screens/TrashScreen';
import AnalyticsScreen from './src/screens/AnalyticsScreen';
import FilesScreen from './src/screens/FilesScreen';
import AllFilesScreen from './src/screens/AllFilesScreen';
import SharedLinksScreen from './src/screens/SharedLinksScreen';
import SharedLinkDetailScreen from './src/screens/SharedLinkDetailScreen';
import UploadManagerScreen from './src/screens/UploadManagerScreen';
import MainTabs from './src/navigation/MainTabs';
import AnimatedSplashScreen from './src/screens/AnimatedSplashScreen';

import SyncActivityOverlay from './src/components/SyncActivityOverlay';
import ServerWakingOverlay from './src/components/ServerWakingOverlay';
import AppErrorBoundary from './src/components/AppErrorBoundary';
import { logger } from './src/utils/logger';
import {
    handleUploadNotificationAction,
    UPLOAD_NOTIFICATION_ACTION_CANCEL,
    UPLOAD_NOTIFICATION_ACTION_PAUSE,
    UPLOAD_NOTIFICATION_ACTION_RESUME,
    UPLOAD_NOTIFICATION_CATEGORY_ID,
} from './src/services/UploadManager';

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
    const { theme } = useTheme();
    const isAuthenticated = auth?.isAuthenticated;
    const isLoading = auth?.isLoading;
    const linking = getLinking(Boolean(isAuthenticated));
    const [isSplashAnimationDone, setIsSplashAnimationDone] = useState(false);
    const previousBgRef = useRef(theme.colors.background);
    const transitionOpacity = useRef(new Animated.Value(0)).current;

    const navigationTheme = useMemo(() => {
        const baseTheme = theme.mode === 'dark' ? NavigationDarkTheme : NavigationDefaultTheme;
        return {
            ...baseTheme,
            colors: {
                ...baseTheme.colors,
                primary: theme.colors.primary,
                background: theme.colors.background,
                card: theme.colors.card,
                text: theme.colors.textHeading,
                border: theme.colors.border,
                notification: theme.colors.accent,
            },
        };
    }, [theme]);

    useEffect(() => {
        if (previousBgRef.current === theme.colors.background) {
            return;
        }

        transitionOpacity.stopAnimation();
        transitionOpacity.setValue(1);
        Animated.timing(transitionOpacity, {
            toValue: 0,
            duration: 220,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: Platform.OS !== 'web',
        }).start();
        previousBgRef.current = theme.colors.background;
    }, [theme.colors.background, transitionOpacity]);

    return (
        <NavigationContainer linking={linking} theme={navigationTheme}>
            <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
                <StatusBar
                    barStyle={theme.mode === 'dark' ? 'light-content' : 'dark-content'}
                    backgroundColor={theme.colors.background}
                />
                <Stack.Navigator
                    id="root"
                    initialRouteName={isAuthenticated ? 'MainTabs' : 'Welcome'}
                    screenOptions={{ headerShown: false, animation: 'slide_from_right' }}
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
                            <Stack.Screen name="Analytics" component={AnalyticsScreen} />
                            <Stack.Screen name="Files" component={FilesScreen} />
                            <Stack.Screen name="AllFiles" component={AllFilesScreen} />
                            <Stack.Screen name="SharedLinks" component={SharedLinksScreen} />
                            <Stack.Screen name="SharedLinkDetail" component={SharedLinkDetailScreen} />
                            <Stack.Screen name="UploadManager" component={UploadManagerScreen} />
                        </>
                    )}
                </Stack.Navigator>
                <SyncActivityOverlay />
                <ServerWakingOverlay />

                {(!isSplashAnimationDone || !!isLoading) && (
                    <AnimatedSplashScreen
                        onAnimationComplete={() => setIsSplashAnimationDone(true)}
                        isAuthLoading={!!isLoading}
                    />
                )}
                <Animated.View
                    style={{
                        position: 'absolute',
                        top: 0,
                        right: 0,
                        bottom: 0,
                        left: 0,
                        pointerEvents: 'none' as any,
                        backgroundColor: previousBgRef.current,
                        opacity: transitionOpacity,
                    }}
                />
            </View>
        </NavigationContainer>
    );
}

export default function App() {
    const [fontsLoaded] = useFonts({
        Inter_400Regular,
        Inter_500Medium,
        Inter_600SemiBold,
        Inter_700Bold,
    });

    useEffect(() => {
        const globalAny = global as any;
        const ErrorUtilsRef = globalAny?.ErrorUtils;
        const existingGlobalHandler = ErrorUtilsRef?.getGlobalHandler?.();
        let notificationResponseSubscription: { remove: () => void } | null = null;
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

        if (Platform.OS !== 'web') {
            const Notifications = require('expo-notifications');

            if (Platform.OS === 'android') {
                Notifications.setNotificationChannelAsync('upload_channel', {
                    name: 'File Transfers',
                    importance: Notifications.AndroidImportance.LOW,
                    description: 'Shows file upload and download progress',
                    enableVibrate: false,
                    showBadge: false,
                });
            }

            Notifications.setNotificationCategoryAsync(UPLOAD_NOTIFICATION_CATEGORY_ID, [
                {
                    identifier: UPLOAD_NOTIFICATION_ACTION_PAUSE,
                    buttonTitle: 'Pause',
                },
                {
                    identifier: UPLOAD_NOTIFICATION_ACTION_RESUME,
                    buttonTitle: 'Resume',
                },
                {
                    identifier: UPLOAD_NOTIFICATION_ACTION_CANCEL,
                    buttonTitle: 'Cancel',
                    options: { isDestructive: true },
                },
            ]).catch(() => { });

            Notifications.requestPermissionsAsync().then(({ status }: { status: string }) => {
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

            notificationResponseSubscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
                const actionId = String(response?.actionIdentifier || '');
                if (!actionId || actionId === 'expo.modules.notifications.actions.DEFAULT') return;
                handleUploadNotificationAction(actionId);
            });
        }

        return () => {
            notificationResponseSubscription?.remove();
            if (ErrorUtilsRef?.setGlobalHandler && existingGlobalHandler) {
                ErrorUtilsRef.setGlobalHandler(existingGlobalHandler);
            }
        };
    }, []);

    if (!fontsLoaded) {
        return null;
    }

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <SafeAreaProvider>
                <ThemeProvider>
                    <ServerStatusProvider>
                        <UploadProvider>
                            <DownloadProvider>
                                <AuthProvider>
                                    <ToastProvider>
                                        <AppErrorBoundary>
                                            <RootNavigator />
                                        </AppErrorBoundary>
                                    </ToastProvider>
                                </AuthProvider>
                            </DownloadProvider>
                        </UploadProvider>
                    </ServerStatusProvider>
                </ThemeProvider>
            </SafeAreaProvider>
        </GestureHandlerRootView>
    );
}
