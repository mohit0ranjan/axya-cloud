export const theme = {
    colors: {
        background: '#f8f8fb', // Soft grayish white
        primary: '#3174ff', // Electric blue
        primaryLight: '#aec3fc', // Light blue tint
        accent: '#fcbd0b', // vibrant yellow
        textHeading: '#1a1f36', // Dark navy black
        textBody: '#76819a', // grayish text
        card: '#ffffff', // pure white
        border: '#edf1f7', // light border
        danger: '#fb4e4e', // Red for delete/errors
        success: '#1fd45a'
    },
    shadows: {
        soft: {
            shadowColor: '#3174ff',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.1,
            shadowRadius: 20,
            elevation: 8,
        },
        card: {
            shadowColor: '#8a95a5',
            shadowOffset: { width: 0, height: 10 },
            shadowOpacity: 0.08,
            shadowRadius: 15,
            elevation: 4,
        }
    },
    radius: {
        card: 24,
        button: 16,
        badge: 8,
        circle: 999,
    }
};
