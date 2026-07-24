/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./mini.html",
    "./src/**/*.{ts,js}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      colors: {
        accent: '#2dd4bf',
      },
    },
  },
  plugins: [],
};
