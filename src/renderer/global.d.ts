import type { LoomApi } from "../preload/index";

declare global {
  interface Window {
    loom: LoomApi;
  }
}

export {};
