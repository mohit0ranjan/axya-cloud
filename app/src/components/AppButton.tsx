import React, { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useTheme } from '../context/ThemeContext';
import { layout } from '../ui/layout';

type Variant = 'primary' | 'secondary' | 'danger';
type Size = 'sm' | 'md' | 'lg';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

const HEIGHT_BY_SIZE: Record<Size, number> = {
  sm: 40,
  md: 48,
  lg: 56,
};

function AppButtonComponent({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  icon,
  style,
}: Props) {
  const { theme } = useTheme();
  const isDisabled = disabled || loading;
  const height = HEIGHT_BY_SIZE[size];
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    if (!isDisabled) scale.value = withSpring(0.97, layout.animation.springSmooth);
  };
  const handlePressOut = () => {
    scale.value = withSpring(1, layout.animation.springSmooth);
  };

  const variantStyle =
    variant === 'secondary'
      ? { backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border }
      : variant === 'danger'
        ? { backgroundColor: theme.colors.danger }
        : { backgroundColor: theme.colors.primary };

  const textColor = variant === 'secondary' ? theme.colors.textHeading : '#fff';

  return (
    <Animated.View style={[animatedStyle, fullWidth && styles.fullWidth, style]}>
      <Pressable
        accessibilityRole="button"
        disabled={isDisabled}
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={({ pressed }) => [
          styles.base,
          { height, opacity: pressed && !isDisabled ? 0.9 : 1 },
          variantStyle,
          fullWidth && styles.fullWidth,
          isDisabled && styles.disabled,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={textColor} size="small" />
        ) : (
          <View style={styles.content}>
            {icon}
            <Text style={[styles.text, { color: textColor }]}>{label}</Text>      
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export default memo(AppButtonComponent);

const styles = StyleSheet.create({
  base: {
    borderRadius: layout.radiusMap.button,
    paddingHorizontal: layout.spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.6,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: layout.spacing.sm,
  },
  text: {
    fontSize: 15,
    fontWeight: '600',
  },
});
