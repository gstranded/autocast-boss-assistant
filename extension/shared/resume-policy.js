export function planResumeSend({ settings = {}, hasImages = false } = {}) {
  const timing = settings.resumeSendTiming || 'after_text';
  const flagImage = Boolean(settings.autoSendImageResume);
  const wantAutoImage = Boolean(flagImage && hasImages);
  const doResume = Boolean(wantAutoImage && timing === 'after_text');
  return {
    timing,
    flagImage,
    wantAutoImage,
    doResume
  };
}
