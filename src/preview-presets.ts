export type Viewport = 'desktop' | 'tablet' | 'mobilePortrait' | 'mobileLandscape';
export type SaveViewport = Viewport | 'phone';
export type PreviewPreset = Viewport | 'huaweiP70ProPlus' | 'custom';
export type PreviewConfig = {
  preset: PreviewPreset;
  huaweiOrientation: 'nativeLandscape' | 'rotatedPortrait';
  customWidth: number;
  customHeight: number;
};

export const viewports = {
  desktop: { label: '电脑', width: 1440, height: 900 },
  tablet: { label: '平板', width: 1024, height: 768 },
  mobilePortrait: { label: '手机竖屏', width: 390, height: 844 },
  mobileLandscape: { label: '手机横屏', width: 844, height: 390 },
};

// The display frame is estimated from the user's landscape phone screenshot after
// removing its white status/title bars. The game page itself uses a portrait viewport
// and rotates its stage, so the editor counter-rotates that page inside this frame.
export const huaweiViewport = { width: 763, height: 378 };
export const huaweiPortraitViewport = { width: 378, height: 763 };

export function validDimension(value: number) {
  return Number.isInteger(value) && value >= 100 && value <= 4096;
}

export function selectPreviewPreset(config: PreviewConfig, preset: PreviewPreset): PreviewConfig {
  return {
    ...config,
    preset,
    huaweiOrientation: preset === 'huaweiP70ProPlus' && config.preset !== 'huaweiP70ProPlus'
      ? 'rotatedPortrait'
      : config.huaweiOrientation,
  };
}

export function readPreviewConfig(raw: string | null, fallback: Viewport): PreviewConfig {
  const defaults: PreviewConfig = { preset: fallback, huaweiOrientation: 'rotatedPortrait', customWidth: 763, customHeight: 378 };
  try {
    const saved = JSON.parse(raw || 'null');
    if (!saved || !['desktop', 'tablet', 'mobilePortrait', 'mobileLandscape', 'huaweiP70ProPlus', 'custom'].includes(saved.preset)
      || !['nativeLandscape', 'landscape', 'rotatedPortrait', 'portrait', 'wechatLandscape'].includes(saved.huaweiOrientation)
      || !validDimension(saved.customWidth) || !validDimension(saved.customHeight)) return defaults;
    // Only the explicit new nativeLandscape value opts into direct landscape mode.
    // Older builds used landscape as the default, so migrate it to the corrected view.
    const huaweiOrientation = saved.huaweiOrientation === 'nativeLandscape' ? 'nativeLandscape' : 'rotatedPortrait';
    return { preset: saved.preset, huaweiOrientation, customWidth: saved.customWidth, customHeight: saved.customHeight };
  } catch { return defaults; }
}

export function resolvePreview(config: PreviewConfig) {
  if (config.preset === 'custom') return { label: '自定义', width: config.customWidth, height: config.customHeight };
  if (config.preset === 'huaweiP70ProPlus') {
    return { label: '华为 Pura 70 Pro+ · 横屏显示', width: huaweiViewport.width, height: huaweiViewport.height };
  }
  return viewports[config.preset];
}

export function resolvePageViewport(config: PreviewConfig) {
  if (config.preset === 'huaweiP70ProPlus' && config.huaweiOrientation === 'rotatedPortrait') {
    return { label: '手机网页视口（横屏显示）', width: huaweiPortraitViewport.width, height: huaweiPortraitViewport.height };
  }
  return resolvePreview(config);
}

export function rotatesHuaweiPreview(config: PreviewConfig) {
  return config.preset === 'huaweiP70ProPlus' && config.huaweiOrientation === 'rotatedPortrait';
}

export function shouldEmulateMobilePreview(config: PreviewConfig) {
  if (config.preset === 'mobilePortrait' || config.preset === 'mobileLandscape' || config.preset === 'huaweiP70ProPlus') return true;
  if (config.preset === 'custom') return Math.min(config.customWidth, config.customHeight) <= 600;
  return false;
}

export function previewUrlWithMobileEnvironment(url: string, mobile: boolean) {
  const parsed = new URL(url);
  parsed.searchParams.set('__editor_mobile_preview', mobile ? '1' : '0');
  return parsed.toString();
}

export function saveViewportForPreview(config: PreviewConfig): SaveViewport {
  // Phone edits follow the phone across rotation and WebView viewport changes.
  if (shouldEmulateMobilePreview(config)) return 'phone';
  if (config.preset !== 'custom' && config.preset !== 'huaweiP70ProPlus') return config.preset;
  // Match the existing write-back media queries so edits also apply after reload.
  const { width } = resolvePageViewport(config);
  if (width <= 500) return 'mobilePortrait';
  if (width <= 900) return 'mobileLandscape';
  if (width <= 1200) return 'tablet';
  return 'desktop';
}
