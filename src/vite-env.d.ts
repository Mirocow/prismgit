/// <reference types="vite/client" />

interface Window {
  smartgit: import('../electron/preload').SmartGitApi;
}

declare global {
  interface Window {
    smartgit: import('../electron/preload').SmartGitApi;
  }
}

export {};
