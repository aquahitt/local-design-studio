import type { Viewport, SafeArea } from "../core/viewport";
export type DevicePreset = {
  id: string;
  name: string;
  group: string;
  width: number;
  height: number;
  safeArea: SafeArea;
  cutout: "none" | "pill" | "notch";
};
const zero = { top: 0, right: 0, bottom: 0, left: 0 };
export const DEVICE_PRESETS: DevicePreset[] = [
  {
    id: "phone-compact",
    name: "Компактный телефон · 360 × 800",
    group: "Телефоны",
    width: 360,
    height: 800,
    safeArea: { ...zero, top: 24, bottom: 24 },
    cutout: "none",
  },
  {
    id: "phone-pill",
    name: "Телефон с островком · 390 × 844",
    group: "Телефоны",
    width: 390,
    height: 844,
    safeArea: { ...zero, top: 54, bottom: 34 },
    cutout: "pill",
  },
  {
    id: "phone-notch",
    name: "Телефон с вырезом · 430 × 932",
    group: "Телефоны",
    width: 430,
    height: 932,
    safeArea: { ...zero, top: 48, bottom: 34 },
    cutout: "notch",
  },
  {
    id: "tablet",
    name: "Планшет · 768 × 1024",
    group: "Планшеты",
    width: 768,
    height: 1024,
    safeArea: { ...zero, top: 24, bottom: 20 },
    cutout: "none",
  },
  {
    id: "tablet-large",
    name: "Большой планшет · 1024 × 1366",
    group: "Планшеты",
    width: 1024,
    height: 1366,
    safeArea: { ...zero, top: 24, bottom: 20 },
    cutout: "none",
  },
  {
    id: "laptop",
    name: "Ноутбук · 1440 × 900",
    group: "Компьютеры",
    width: 1440,
    height: 900,
    safeArea: zero,
    cutout: "none",
  },
  {
    id: "desktop",
    name: "Монитор · 1920 × 1080",
    group: "Компьютеры",
    width: 1920,
    height: 1080,
    safeArea: zero,
    cutout: "none",
  },
];
export function presetViewport(
  preset: DevicePreset,
  rotated = false,
): Viewport {
  const phone = preset.group === "Телефоны";
  return {
    width: rotated ? preset.height : preset.width,
    height: rotated ? preset.width : preset.height,
    device: {
      preset: preset.id,
      orientation: (
        rotated ? preset.height > preset.width : preset.width > preset.height
      )
        ? "landscape"
        : "portrait",
      cutout: preset.cutout,
      safeArea:
        rotated && phone
          ? {
              top: 0,
              right: preset.safeArea.top,
              bottom: 21,
              left: preset.safeArea.top,
            }
          : structuredClone(preset.safeArea),
    },
  };
}
