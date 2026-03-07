import React from 'react';
import { Pressable, StyleSheet, type Insets, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';

type Variant = 'ghost' | 'surface' | 'primary';

type Props = {
  onPress: (event?: any) => void;
  icon: React.ReactNode;
  variant?: Variant;
  size?: number;
  disabled?: boolean;
  hitSlop?: Insets;
  style?: StyleProp<ViewStyle>;
};

const DEFAULT_HIT_SLOP: Insets = { top: 8, right: 8, bottom: 8, left: 8 };

export default function IconButton({
  onPress,
  icon,
  variant = 'ghost',
  size = 44,
  disabled = false,
  hitSlop = DEFAULT_HIT_SLOP,
  style,
}: Props) {
  const { theme } = useTheme();

  const variantStyle =
    variant === 'surface'
      ? { backgroundColor: theme.colors.card, borderWidth: 1, borderColor: theme.colors.border }
      : variant === 'primary'
        ? { backgroundColor: theme.colors.primary }
        : { backgroundColor: 'transparent' };

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { width: size, height: size, borderRadius: size / 2, opacity: pressed && !disabled ? 0.86 : 1 },
        variantStyle,
        disabled && styles.disabled,
        style,
      ]}
    >
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: {
    opacity: 0.5,
  },
});
