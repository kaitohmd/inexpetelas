(function expose(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.screenQuality = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createScreenQuality() {
  const presets = {
    smooth: { label: '720p · 60 FPS', width: 1280, height: 720, fps: 60, bitrate: 5_000_000 },
    sharp: { label: '1080p · 60 FPS', width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 },
    light: { label: '720p · 30 FPS', width: 1280, height: 720, fps: 30, bitrate: 3_000_000 }
  };
  // Keep un-focused shares light; the selected viewer's focus request promotes it.
  const preview = { width: 320, height: 180, fps: 8, bitrate: 220_000 };
  const cpuSaver = { width: 960, height: 540, fps: 24, bitrate: 1_800_000 };
  const maxUpstreamBitrate = 8_000_000;

  function outgoingProfile(focused, quality, peerCount, cpuLimited = false) {
    const selected = focused ? (cpuLimited ? cpuSaver : presets[quality]) : preview;
    if (!selected) throw new RangeError(`Unknown screen quality: ${quality}`);
    return {
      width: selected.width,
      height: selected.height,
      maxFramerate: selected.fps,
      // With an SFU, the sender uploads one copy regardless of how many people watch.
      maxBitrate: Math.min(selected.bitrate, maxUpstreamBitrate),
      scaleResolutionDownBy: 1,
      priority: focused ? 'high' : 'very-low'
    };
  }

  function captureProfile(hasFocusedViewer, quality, cpuLimited = false) {
    const selected = hasFocusedViewer ? (cpuLimited ? cpuSaver : presets[quality]) : preview;
    if (!selected) throw new RangeError(`Unknown screen quality: ${quality}`);
    return { width: selected.width, height: selected.height, frameRate: selected.fps };
  }

  return { presets, outgoingProfile, captureProfile, maxUpstreamBitrate };
});
