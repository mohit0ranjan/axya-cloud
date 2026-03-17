import React, { useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Animated as RNAnimated } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HardDrive, Folder, Star, User, Plus } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../context/ThemeContext';

import HomeScreen from '../screens/HomeScreen';
import FoldersScreen from '../screens/FoldersScreen';
import StarredScreen from '../screens/StarredScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();

const CustomTabBar = ({ state, descriptors, navigation }: any) => {
    const { theme } = useTheme();
    const isDark = theme.mode === 'dark';
    const fabScale = useRef(new RNAnimated.Value(1)).current;

    const onFabPressIn = () => {
        RNAnimated.spring(fabScale, {
            toValue: 0.85,
            useNativeDriver: true,
            tension: 300,
            friction: 15,
        }).start();
    };

    const onFabPressOut = () => {
        RNAnimated.spring(fabScale, {
            toValue: 1,
            useNativeDriver: true,
            tension: 300,
            friction: 15,
        }).start();
    };

    return (
        <View style={[
            styles.navBar,
            {
                backgroundColor: isDark ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.95)',
                borderColor: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(15,23,42,0.08)',
                shadowColor: isDark ? '#020617' : '#475569',
            },
        ]}>
            {state.routes.map((route: any, index: number) => {
                const { options } = descriptors[route.key];
                
                // Hide tab bar buttons for specific screens
                if (options.tabBarButton === (() => null) || options.tabBarStyle?.display === 'none' || route.name === 'StorageAnalytics' || route.name === 'Trash') {
                    return null;
                }
                
                const label = options.tabBarLabel !== undefined ? options.tabBarLabel : options.title !== undefined ? options.title : route.name;
                const isFocused = state.index === index;

                const onPress = () => {
                    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                    if (!isFocused && !event.defaultPrevented) {
                        navigation.navigate({ name: route.name, merge: true });
                    }
                };

                const onLongPress = () => {
                    navigation.emit({ type: 'tabLongPress', target: route.key });
                };

                const activeColor = theme.colors.primary;
                const inactiveColor = isDark ? 'rgba(255,255,255,0.4)' : '#94A3B8';
                const color = isFocused ? activeColor : inactiveColor;

                let IconComponent;
                if (route.name === 'Home') IconComponent = <HardDrive color={color} size={22} />;
                else if (route.name === 'Folders') IconComponent = <Folder color={color} size={22} />;
                else if (route.name === 'Starred') IconComponent = <Star color={color} size={22} />;
                else if (route.name === 'Profile') IconComponent = <User color={color} size={22} />;

                if (route.name === 'Create') {
                    return (
                        <TouchableOpacity
                            key={index}
                            style={styles.fabTouch}
                            onPress={() => navigation.navigate('Home', { openFabAt: Date.now() })}
                            onPressIn={onFabPressIn}
                            onPressOut={onFabPressOut}
                            activeOpacity={1}
                        >
                            <RNAnimated.View style={{ transform: [{ scale: fabScale }] }}>
                                <LinearGradient
                                    colors={[theme.colors.fabGradientStart, theme.colors.fabGradientEnd]}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                    style={styles.fab}
                                >
                                    <Plus color="#fff" size={28} strokeWidth={2.5} />
                                </LinearGradient>
                            </RNAnimated.View>
                        </TouchableOpacity>
                    );
                }

                return (
                    <TouchableOpacity
                        key={index}
                        accessibilityRole="button"
                        accessibilityState={isFocused ? { selected: true } : {}}
                        accessibilityLabel={options.tabBarAccessibilityLabel}
                        testID={options.tabBarTestID}
                        onPress={onPress}
                        onLongPress={onLongPress}
                        style={styles.navItem}
                        activeOpacity={0.86}
                    >
                        <View
                            style={[
                                styles.navItemInner,
                                isFocused && {
                                    backgroundColor: isDark ? 'rgba(59,130,246,0.20)' : 'rgba(59,130,246,0.12)',
                                    transform: [{ scale: 1.06 }],
                                },
                            ]}
                        >
                            {IconComponent}
                            <Text style={[
                                styles.navLabel,
                                { color },
                                isFocused && styles.navLabelActive
                            ]}>{label}</Text>
                        </View>
                    </TouchableOpacity>
                );
            })}
        </View>
    );
};

export default function MainTabs() {
    return (
        <Tab.Navigator
            id="main-tabs"
            tabBar={(props) => <CustomTabBar {...props} />}
            screenOptions={{ headerShown: false }}
        >
            <Tab.Screen name="Home" component={HomeScreen} />
            <Tab.Screen name="Folders" component={FoldersScreen} />
            <Tab.Screen name="Create" component={DummyScreen} />
            <Tab.Screen name="Starred" component={StarredScreen} />
            <Tab.Screen name="Profile" component={ProfileScreen} />
        </Tab.Navigator>
    );
}

// Dummy component for the 'Create' tab route which we intercept
const DummyScreen = () => null;

const styles = StyleSheet.create({
    navBar: {
        position: 'absolute',
        bottom: 0, left: 0, right: 0,
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        height: Platform.OS === 'ios' ? 88 : 70,
        paddingBottom: Platform.OS === 'ios' ? 20 : 0,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        shadowOffset: { width: 0, height: -6 },
        shadowOpacity: 0.14,
        shadowRadius: 22,
        elevation: 16,
        borderTopWidth: 1,
    },
    navItem: {
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        height: '100%',
    },
    navItemInner: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 20,
    },
    navLabel: {
        fontSize: 10,
        fontWeight: '600',
        marginTop: 3,
    },
    navLabelActive: {
        fontWeight: '700',
    },
    fabTouch: {
        marginTop: -34,
    },
    fab: {
        width: 64,
        height: 64,
        borderRadius: 32,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#3B82F6',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.42,
        shadowRadius: 24,
        elevation: 12,
    },
});
