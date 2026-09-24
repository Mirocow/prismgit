module.exports = {
  plugins: {
    // Tailwind v4 ships its PostCSS plugin as a separate package — the v3
    // `tailwindcss: {}` entry no longer works in v4.
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
};
