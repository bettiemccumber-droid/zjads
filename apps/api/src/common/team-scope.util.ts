import { PrismaService } from '../prisma/prisma.service';

/** 组长在 JWT 校验后附带的直属组员 id 列表 */
export async function loadTeamMemberIds(
  prisma: PrismaService,
  leaderUserId: number,
): Promise<number[]> {
  const members = await prisma.user.findMany({
    where: { reportsToId: leaderUserId, isActive: true },
    select: { id: true },
    orderBy: { username: 'asc' },
  });
  return members.map((m) => m.id);
}

/**
 * 结算/拒付等「团队视角」下的数据归属用户 id（含本人）。
 * 组长：本人 + 直属组员；组员：同组组长 + 全组组员；无编制：仅本人。
 */
export async function resolveTeamOwnerUserIds(
  prisma: PrismaService,
  userId: number,
  teamMemberIds?: number[],
): Promise<number[]> {
  if (teamMemberIds?.length) {
    return [...new Set([userId, ...teamMemberIds])];
  }
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { reportsToId: true },
  });
  if (me?.reportsToId) {
    const peerIds = await loadTeamMemberIds(prisma, me.reportsToId);
    return [...new Set([me.reportsToId, ...peerIds])];
  }
  return [userId];
}

/** 组长可见的组员简要信息（/auth/me） */
export async function loadTeamMembersForLeader(
  prisma: PrismaService,
  leaderUserId: number,
): Promise<Array<{ id: number; username: string }>> {
  return prisma.user.findMany({
    where: { reportsToId: leaderUserId, isActive: true },
    select: { id: true, username: true },
    orderBy: { username: 'asc' },
  });
}
