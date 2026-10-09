import React, { useEffect, useRef } from "react";
import { Animated, Platform, ScrollView, StyleSheet } from "react-native";
import { useTheme } from "../context/ThemeContext";
import { useReducedMotion } from "../hooks/useReducedMotion";
interface Props {
  children: React.ReactNode;
  keyboardVisible: boolean;
}
export default React.memo(function LoginCard({
  children,
  keyboardVisible,
}: Props) {
  const { theme } = useTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const entrance = Animated.timing(opacity, {
      toValue: 1,
      duration: reducedMotion ? 0 : 220,
      useNativeDriver: Platform.OS !== "web",
    });
    entrance.start();
    return () => entrance.stop();
  }, [opacity, reducedMotion]);
  return (
    <Animated.View
      style={[
        s.card,
        {
          opacity,
          backgroundColor: theme.colors.card,
          borderColor: theme.colors.border,
          marginBottom: keyboardVisible ? 12 : 0,
        },
      ]}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
        keyboardDismissMode="on-drag"
        contentContainerStyle={s.content}
      >
        {children}
      </ScrollView>
    </Animated.View>
  );
});
const s = StyleSheet.create({
  card: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    borderRadius: 30,
    borderWidth: 1,
    maxHeight: "75%",
    overflow: "hidden",
  },
  content: { alignItems: "center", padding: 24, gap: 20 },
});
