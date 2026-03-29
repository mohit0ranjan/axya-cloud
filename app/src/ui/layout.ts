export const layout = {
  spacing: {
    // 8px grid system
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    '2xl': 32,
    '3xl': 40,
    '4xl': 48,
  },
  padding: {
    screen: 24, // Global screen padding (replaced the 24/20/18/16 chaos)
    card: 16,
    input: 14,
    button: 16,
  },
  radiusMap: {
    sm: 8,
    md: 12,
    button: 12, // Consolidated button radius
    card: 20, // Consolidated card radius
    modal: 24,
    hero: 32,
    full: 9999,
  },
  shadows: {
    soft: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.06,
      shadowRadius: 10,
      elevation: 2,
    },
    medium: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.1,
      shadowRadius: 20,
      elevation: 4,
    },
    none: {
      shadowColor: 'transparent',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0,
      shadowRadius: 0,
      elevation: 0,
    }
  },
  animation: {
    springFast: { tension: 300, friction: 20 },
    springSmooth: { damping: 20, stiffness: 200 },
    duration: 250,
  }
};
