import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { loadTeamMembersForLeader } from '../common/team-scope.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const normalizedEmail = email.trim();
    const user = await this.prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('邮箱或密码错误');
    }
    const token = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
    });
    let teamMembers: Awaited<ReturnType<typeof loadTeamMembersForLeader>> = [];
    try {
      teamMembers = await loadTeamMembersForLeader(this.prisma, user.id);
    } catch {
      /* 组员列表查询失败不应阻断登录 */
    }
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        teamMembers,
      },
    };
  }

  async getMe(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        organizationId: true,
      },
    });
    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }
    const teamMembers = await loadTeamMembersForLeader(this.prisma, userId);
    return { ...user, teamMembers };
  }
}
