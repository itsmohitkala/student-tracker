/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0b0f14',
          900: '#0f1620',
          800: '#151d2b',
          700: '#1c2637',
          600: '#2a3648',
          500: '#3d4d63',
          400: '#5b6b81',
          300: '#8493a6',
          200: '#b7c1cf',
          100: '#e2e7ed',
          50: '#f5f7fa',
        },
        brand: {
          700: '#1e3a5f',
          600: '#25507f',
          500: '#2f6690',
          400: '#4d84ab',
        },
      },
      fontFamily: {
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
