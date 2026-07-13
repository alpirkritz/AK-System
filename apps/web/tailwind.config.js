/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#2dd4bf',
          50: '#e6fbf7',
          100: '#c2f4ea',
          200: '#8fe9d9',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0f9488',
          700: '#0c7268',
          800: '#0a4f49',
          900: '#062f2b',
        },
        coral: {
          DEFAULT: '#fb7185',
          400: '#fb7185',
          500: '#f43f5e',
        },
        surface: {
          DEFAULT: '#0e1626',
          card: '#1a2740',
          border: '#2f4368',
          hover: '#29395d',
        },
        text: {
          heading: '#eef3fb',
          body: '#97a4c2',
          muted: '#647399',
          disabled: '#4d659c',
        },
        success: { DEFAULT: '#34d399', muted: '#34d39922' },
        warning: { DEFAULT: '#fbbf24', muted: '#fbbf2422' },
        error:   { DEFAULT: '#fb7185', muted: '#fb718522' },
        info:    { DEFAULT: '#38bdf8', muted: '#38bdf822' },
      },
      fontFamily: {
        sans: ['Heebo', 'Assistant', 'system-ui', 'sans-serif'],
      },
      ringOffsetColor: {
        surface: '#0e1626',
      },
    },
  },
  plugins: [],
  darkMode: 'class',
}
