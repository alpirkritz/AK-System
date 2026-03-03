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
          DEFAULT: '#e8c547',
          50: '#fdf8e7',
          100: '#f9eebb',
          200: '#f0d96b',
          300: '#e8c547',
          400: '#e0b020',
          500: '#c4950f',
          600: '#9a7309',
          700: '#6b5006',
          800: '#3d2e04',
          900: '#1a1502',
        },
        surface: {
          DEFAULT: '#0f0f0f',
          card: '#161616',
          border: '#1a1a1a',
          hover: '#1f1f1f',
        },
      },
      fontFamily: {
        sans: ['Heebo', 'Assistant', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
  darkMode: 'class',
}
