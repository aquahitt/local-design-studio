import type { LibraryMetadata } from "../library/sdk";
export interface DesktopLibrary {
  metadata: LibraryMetadata;
  bundleUrl: string;
  cssUrl: string;
}
export interface DesktopProject {
  root: string;
  name: string;
  library?: DesktopLibrary;
  libraryError?: string;
}
export interface DesktopBridge {
  setLocale(locale: "ru" | "en"): Promise<null>;
  recent(): Promise<DesktopProject[]>;
  create(name: string): Promise<DesktopProject | null>;
  open(): Promise<DesktopProject | null>;
  example(): Promise<DesktopProject>;
  reopen(root: string): Promise<DesktopProject>;
  home(): Promise<null>;
  status(): Promise<DesktopProject | null>;
  library(): Promise<DesktopLibrary | null>;
  configureLibrary(): Promise<DesktopProject | null>;
  clearLibrary(): Promise<DesktopProject>;
}
declare global {
  interface Window {
    studioDesktop?: DesktopBridge;
  }
}
