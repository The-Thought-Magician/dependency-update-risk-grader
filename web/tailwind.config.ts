import type { Config } from 'tailwindcss'
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-work-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
}
export default config
