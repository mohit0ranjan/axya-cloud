import React from "react";
import { Animated, StyleSheet, Text, useWindowDimensions } from "react-native";
import AxyaBrandMark from "./AxyaBrandMark";
import { useTheme } from "../context/ThemeContext";
interface Props {
  keyboardVisible: boolean;
  heroOpacity: Animated.Value;
  heroScale: Animated.Value;
  heroShrink: Animated.Value;
  heroFadeOut: Animated.Value;
}
export default React.memo(function HeroSection({
  keyboardVisible,
  heroOpacity,
  heroScale,
  heroShrink,
  heroFadeOut,
}: Props) {
  const { theme } = useTheme();
  const { height } = useWindowDimensions();
  const compact = height < 700;
  if (keyboardVisible) return null;
  return (
    <Animated.View
      style={[
        s.root,
        compact && { minHeight: 174, paddingTop: 12, paddingBottom: 12 },
        {
          opacity: Animated.multiply(heroOpacity, heroFadeOut),
          transform: [{ scale: Animated.multiply(heroScale, heroShrink) }],
        },
      ]}
    >
      <AxyaBrandMark size={compact ? 128 : 176} />
      <Text style={[s.title, { color: theme.colors.textHeading }]}>Axya</Text>
    </Animated.View>
  );
});
const s = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 170,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 36,
    paddingBottom: 24,
    paddingHorizontal: 12,
  },
  logo: { width: 72, height: 72, borderRadius: 22, marginBottom: 18 },
  title: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 24,
    lineHeight: 32,
    marginTop: 12,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  subtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 12,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 6,
  },
});
