import React, { useContext, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';

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


const Stack = createNativeStackNavigator();

function RootNavigator() {
    const { isAuthenticated, isLoading } = useContext(AuthContext);
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
                {isAuthenticated && <UploadProgressOverlay />}
            </View>
        </NavigationContainer>
    );

}

export default function App() {
    return (
        <ThemeProvider>
            <AuthProvider>
                <ToastProvider>
                    <RootNavigator />
                </ToastProvider>
            </AuthProvider>
        </ThemeProvider>
    );
}
