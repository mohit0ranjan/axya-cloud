import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
        "./lib/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                brand: {
                    start: "#4F6EF7",
                    end: "#5A7BFF",
                    "accent-start": "#6EA8FF",
                    "accent-end": "#9FB6FF",
                    bg: "#F6F8FF",
                    card: "#FFFFFF",
                    text: "#1A1F36",
                    muted: "#6B7280",
                    light: "#EEF1FD",
                    dark: "#2B4FD8",
                },
            },
        },
    },
    plugins: [],
};
export default config;
