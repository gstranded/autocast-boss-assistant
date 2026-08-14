export function planResumeSend({ settings = {}, hasImages = false } = {}) {
  const timing = settings.resumeSendTiming || 'after_text';
  const flagImage = Boolean(settings.autoSendImageResume);
  const wantPlatformResume = Boolean(settings.autoSendAttachmentResume);
  const wantAutoImage = Boolean(flagImage && hasImages);
  const doResume = Boolean((wantAutoImage || wantPlatformResume) && timing === 'after_text');
  return {
    timing,
    flagImage,
    wantPlatformResume,
    wantAutoImage,
    doResume
  };
}
