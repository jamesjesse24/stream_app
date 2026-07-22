const assert = require('node:assert/strict');

function mergeSources(primary, groups) {
  const unique = new Map();
  unique.set(primary.url, primary);
  groups.flat().forEach((source) => {
    if (!source?.url) return;
    const existing = unique.get(source.url);
    if (!existing) {
      unique.set(source.url, source);
      return;
    }
    unique.set(source.url, {
      ...source,
      ...existing,
      fileSizeBytes: existing.fileSizeBytes ?? source.fileSizeBytes,
      fileSizeEstimated: existing.fileSizeEstimated ?? source.fileSizeEstimated,
      mediaInfoStatus: existing.mediaInfoStatus ?? source.mediaInfoStatus,
      isHls: existing.isHls ?? source.isHls,
      videoUrl: existing.videoUrl ?? source.videoUrl,
    });
  });
  return Array.from(unique.values());
}

function resolutionOf(source) {
  return source.quality.match(/(?:2160|1440|1080|720|480|360)p/i)?.[0] || 'HD';
}
function serverOf(source) {
  if (/driveseed\s+cloud/i.test(source.quality)) return 'DriveSeed Cloud';
  if (/driveseed\s+instant/i.test(source.quality)) return 'DriveSeed Instant';
  return 'Primary server';
}
function buildQualityOptions(availableSources, activeSourceIndex) {
  const activeSource = availableSources[activeSourceIndex] || availableSources[0];
  const grouped = new Map();
  availableSources.forEach((source, index) => {
    const resolution = resolutionOf(source);
    const options = grouped.get(resolution) ?? [];
    options.push({ source, index, resolution });
    grouped.set(resolution, options);
  });
  return Array.from(grouped.values()).map((options) => {
    const activeOption = options.find(({ index }) => index === activeSourceIndex);
    if (activeOption) return activeOption;
    const activeServer = activeSource ? serverOf(activeSource) : null;
    const sameServer = activeServer
      ? options.find(({ source }) => serverOf(source) === activeServer)
      : undefined;
    if (sameServer) return sameServer;
    return [...options].sort((left, right) => {
      const leftSize = Number.isFinite(left.source.fileSizeBytes) && left.source.fileSizeBytes > 0
        ? left.source.fileSizeBytes : Number.POSITIVE_INFINITY;
      const rightSize = Number.isFinite(right.source.fileSizeBytes) && right.source.fileSizeBytes > 0
        ? right.source.fileSizeBytes : Number.POSITIVE_INFINITY;
      return leftSize - rightSize || left.index - right.index;
    })[0];
  });
}

const GB = 1024 ** 3;
const high = { url: 'high', quality: '1080p - DriveSeed Instant', fileSizeBytes: 28.15 * GB };
const medium = { url: 'medium', quality: '1080p - DriveSeed Cloud', fileSizeBytes: 13.38 * GB };
const low = { url: 'low', quality: '1080p - DriveSeed Instant', fileSizeBytes: 7.60 * GB };
const sevenTwenty = { url: '720', quality: '720p - DriveSeed Instant', fileSizeBytes: 3.2 * GB };

// The URL chosen on the episode page must remain first/primary after refresh.
const initial = { url: low.url, quality: low.quality };
const merged = mergeSources(initial, [[high, medium, low], [high, medium, low]]);
assert.equal(merged[0].url, 'low');
assert.equal(merged[0].fileSizeBytes, low.fileSizeBytes);

// The current quality card must represent the exact active server, not the
// first or largest source with the same 1080p label.
const available = [high, medium, low, sevenTwenty];
const current1080 = buildQualityOptions(available, 2).find((item) => item.resolution === '1080p');
assert.equal(current1080.source.url, 'low');
assert.equal(current1080.index, 2);

// When changing resolution, preserve the server family when possible.
const current720 = buildQualityOptions(available, 1).find((item) => item.resolution === '720p');
assert.equal(current720.source.url, '720');

console.log('source-selection regression tests passed');
