import type { ReactNode } from "react";
import { contentViewport, type Viewport } from "../core/viewport";
import { StudioButton } from "./DesignSystem";
export function DeviceFrame({
  viewport,
  fallbackHeight = 850,
  theme,
  shade = false,
  onCloseShade,
  children,
}: {
  viewport: Viewport;
  fallbackHeight?: number;
  theme: string;
  shade?: boolean;
  onCloseShade?: () => void;
  children: (size: { width: number; height: number }) => ReactNode;
}) {
  const safe = viewport.device?.safeArea ?? {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const size = contentViewport(viewport, fallbackHeight);
  const rotated = viewport.device?.orientation === "landscape";
  return (
    <div
      className="device-frame"
      data-testid="device-frame"
      data-mode={theme.includes("dark") ? "dark" : "light"}
      style={{
        borderRadius:
          safe.top || safe.bottom || safe.left || safe.right ? 16 : 0,
        width: viewport.width,
        height: viewport.height ?? fallbackHeight,
      }}
    >
      <div
        className="device-content"
        style={{
          left: safe.left,
          top: safe.top,
          width: size.width,
          height: size.height,
        }}
      >
        {children(size)}
      </div>
      {!!safe.top && (
        <div
          className="device-status"
          aria-hidden="true"
          style={{ height: safe.top }}
        >
          <span>12:00</span>
          <span>▂▄▆ ▰</span>
        </div>
      )}
      {!!safe.bottom && (
        <div
          className="device-navigation"
          aria-hidden="true"
          style={{ height: safe.bottom }}
        >
          <span />
        </div>
      )}
      {viewport.device?.cutout !== "none" && viewport.device?.cutout && (
        <div
          className={"device-cutout " + viewport.device.cutout}
          data-orientation={rotated ? "landscape" : "portrait"}
          aria-hidden="true"
        />
      )}
      {shade && (
        <div
          className="device-shade"
          role="dialog"
          style={{ paddingTop: Math.max(20, safe.top + 12) }}
          aria-label="Шторка уведомлений"
        >
          <header>
            <strong>Шторка уведомлений</strong>
            {onCloseShade && (
              <StudioButton onClick={onCloseShade}>Закрыть шторку</StudioButton>
            )}
          </header>
          <p>Системная область уведомлений</p>
          <small>Визуальная модель: данные устройства не подключены.</small>
        </div>
      )}
    </div>
  );
}
