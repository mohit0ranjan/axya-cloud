import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HardDrive, Folder, Upload, Star, User } from 'lucide-react-native';
import { useTheme } from '../context/ThemeContext';

import HomeScreen from '../screens/HomeScreen';
import FoldersScreen from '../screens/FoldersScreen';
import StarredScreen from '../screens/StarredScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();

const CustomTabBar = ({ state, descriptors, navigation }: any) => {
    const { theme } = useTheme();

    return (
        <View style={[styles.navBar, { backgroundColor: theme.colors.card, borderTopColor: theme.colors.border }]}>
            {state.routes.map((route: any, index: number) => {
                const { options } = descriptors[route.key];
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

                const color = isFocused ? theme.colors.primary : theme.colors.textBody;

                let IconComponent;
                if (route.name === 'Home') IconComponent = <HardDrive color={color} size={22} />;
                else if (route.name === 'Folders') IconComponent = <Folder color={color} size={22} />;
                else if (route.name === 'Starred') IconComponent = <Star color={color} size={22} />;
                else if (route.name === 'Profile') IconComponent = <User color={color} size={22} />;

                if (route.name === 'Create') {
                    return (
                        <TouchableOpacity
                            key={index}
                            style={[styles.fab, { backgroundColor: theme.colors.primary }]}
                            onPress={() => navigation.navigate('Home', { openFabAt: Date.now() })}
                            activeOpacity={0.85}
                        >
                            <Upload color="#fff" size={24} strokeWidth={2.5} />
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
                    >
                        {IconComponent}
                        <Text style={[styles.navLabel, { color }]}>{label}</Text>
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
        flexDirection: 'row',
        justifyContent: 'space-around',
        alignItems: 'center',
        height: Platform.OS === 'ios' ? 88 : 70,
        paddingBottom: Platform.OS === 'ios' ? 20 : 0,
        borderTopWidth: 1,
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.05,
        shadowRadius: 10,
    },
    navItem: {
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        height: '100%',
    },
    navLabel: {
        fontSize: 10,
        fontWeight: '600',
        marginTop: 4,
    },
    fab: {
        width: 56,
        height: 56,
        borderRadius: 28,
        justifyContent: 'center',
        alignItems: 'center',
        marginTop: -30,
        shadowColor: '#4B6EF5',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.3,
        shadowRadius: 16,
        elevation: 8,
    },
});
