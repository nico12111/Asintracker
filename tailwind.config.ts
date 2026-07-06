import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9eaff",
          500: "#2b7fff",
          600: "#1a68e6",
          700: "#1553b8",
        },
      },
    },
  },
  plugins: [],
};

export default config;
