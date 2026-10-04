export interface DesktopProject {
  root: string;
  name: string;
}
export interface DesktopBridge {
  recent(): Promise<DesktopProject[]>;
  create(name: string): Promise<DesktopProject | null>;
  open(): Promise<DesktopProject | null>;
  example(): Promise<DesktopProject>;
  reopen(root: string): Promise<DesktopProject>;
  home(): Promise<null>;
  status(): Promise<DesktopProject | null>;
}
declare global {
  interface Window {
    studioDesktop?: DesktopBridge;
  }
}
