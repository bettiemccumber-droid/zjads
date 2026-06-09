import { NormalizedStatus } from '@prisma/client';

/**
 * 将平台原始状态映射为统一状态
 */
export function normalizeStatus(
  raw: string | null | undefined,
  mappings: Array<{ rawStatus: string; normalizedStatus: NormalizedStatus }>,
): { rawStatus: string; normalizedStatus: NormalizedStatus } {
  const rawStatus = String(raw ?? '').trim() || 'Unknown';
  const upper = rawStatus.toUpperCase();
  for (const m of mappings) {
    if (m.rawStatus.toUpperCase() === upper || m.rawStatus === rawStatus) {
      return { rawStatus, normalizedStatus: m.normalizedStatus };
    }
  }
  return { rawStatus, normalizedStatus: NormalizedStatus.unknown };
}
