/// <reference types="vite/client" />

declare const __BUILD_INFO__: {
  version: string;
  commit: string;
  branch: string;
  dirty: boolean;
  channel: "Development" | "Preview" | "Production";
};
