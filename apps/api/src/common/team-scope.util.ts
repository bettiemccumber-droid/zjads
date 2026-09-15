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
