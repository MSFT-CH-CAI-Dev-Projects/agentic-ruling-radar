import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx,mdx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#00b8cf",
          yellow: "#fce300",
          red: "#eb0064",
          warning: "#febf00",
          orange: "#ff8200",
          success: "#208048",
          danger: "#cc3333",
          lime: "#c1e200",
          white: "#ffffff",
          light: "#f2f2f2",
          gray: "#8c8c8c",
          "gray-dark": "#b3b3b3",
          black: "#1a1a1a",
        },
      },
      fontFamily: {
        sans: [
          '"Helvetica Neue LT W04 55 Roman"',
          '"Inter"',
          '"Helvetica Neue"',
          "Helvetica",
          "Arial",
          "system-ui",
          "sans-serif",
        ],
        bold: [
          '"Helvetica Neue LT W04 75 Bold"',
          '"Inter"',
          '"Helvetica Neue"',
          "Helvetica",
          "Arial",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          '"SFMono-Regular"',
          "Menlo",
          "Monaco",
          "Consolas",
          '"Liberation Mono"',
          '"Courier New"',
          "monospace",
        ],
      },
      borderRadius: {
        DEFAULT: "2px",
        md: "4px",
      },
      ringColor: { DEFAULT: "#00b8cf" },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
