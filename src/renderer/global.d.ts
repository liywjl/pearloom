import type { PearloomApi } from "../preload/index";

declare global {
  interface Window {
    pearloom: PearloomApi;
  }
}

export {};
