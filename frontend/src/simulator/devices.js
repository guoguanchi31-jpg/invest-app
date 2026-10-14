export const DEVICE_PRESETS = [
  { id: "iphone-15", name: "iPhone 15 Pro", width: 393, height: 852, kind: "phone" },
  { id: "iphone-se", name: "iPhone SE", width: 375, height: 667, kind: "phone" },
  { id: "pixel-8", name: "Pixel 8", width: 412, height: 915, kind: "phone" },
  { id: "ipad-mini", name: "iPad mini", width: 744, height: 1133, kind: "tablet" },
];

const FRAME_INSET = 28;
const STAGE_GUTTER = 48;
const MIN_SCALE = 0.32;

export function orientedDimensions(device, orientation) {
  return orientation === "portrait"
    ? { width: device.width, height: device.height }
    : { width: device.height, height: device.width };
}

export function fitDeviceScale(stage, device) {
  if (!stage.width || !stage.height) return 0.75;
  const horizontal = (stage.width - STAGE_GUTTER) / (device.width + FRAME_INSET);
  const vertical = (stage.height - STAGE_GUTTER) / (device.height + FRAME_INSET);
  return Math.max(MIN_SCALE, Math.min(1, horizontal, vertical));
}
