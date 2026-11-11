/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: '#0a0e20',
        dark: '#0d1117',
        blue: '#06b6d4',
        cyan: '#0891b2',
        green: '#10b981',
      }
    },
  },
}