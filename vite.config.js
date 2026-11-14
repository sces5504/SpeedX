// vite.config.js — tells Vite that the project has TWO pages to build:
//   index.html     the game
//   catalog.html   the catalogue of everything in the game (src/catalog/)
// `npm run dev` serves both without this file; `npm run build` needs the list,
// otherwise only index.html would end up in dist/.
// (The address the game is published under still comes from the command line:
//  vite build --base=/some-path/ )
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: 'index.html', catalog: 'catalog.html' },
    },
  },
});
