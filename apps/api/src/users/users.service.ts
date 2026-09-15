import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: number) {
    return this.prisma.user.findMany({
      where: { organizationId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        isActive: true,
        reportsToId: true,
        reportsTo: { select: { id: true, username: true } },
        createdAt: true,
      },
      orderBy: { id: 'asc' },
    });
  }

  async create(params: {
    organizationId: number;
    email: string;
    username: string;
    password: string;
    role: UserRole;
  }) {
    const exists = await this.prisma.user.findUnique({ where: { email: params.email } });
    if (exists) throw new ConflictException('邮箱已存在');
    const passwordHash = await bcrypt.hash(params.password, 10);
    return this.prisma.user.create({
      data: {
        organizationId: params.organizationId,
        email: params.email,
        username: params.username,
        passwordHash,
        role: params.role,
      },
      select: { id: true, email: true, username: true, role: true },
    });
  }

  async setActive(id: number, isActive: boolean) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');
    return this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: { id: true, isActive: true },
    });
  }

  /**
   * 更新员工账号（用户名、邮箱、角色、密码）
   */
  /**
   * 校验「所属组长」关系（同组织、非管理员、非自身）
   */
  private async assertValidReportsTo_(
    reportsToId: number | null | undefined,
    userId: number,
    organizationId: number,
  ) {
    if (reportsToId == null) return;
    if (reportsToId === userId) {
      throw new BadRequestException('不能将自己设为所属组长');
    }
    const leader = await this.prisma.user.findUnique({
      where: { id: reportsToId },
      select: { id: true, organizationId: true, role: true, isActive: true },
    });
    if (!leader || leader.organizationId !== organizationId) {
      throw new BadRequestException('指定的组长不存在');
    }
    if (leader.role === UserRole.ADMIN) {
      throw new BadRequestException('管理员不能作为组长');
    }
    if (!leader.isActive) {
      throw new BadRequestException('组长账号已停用');
    }
  }

  async update(
    id: number,
    organizationId: number,
    params: {
      username?: string;
      email?: string;
      role?: UserRole;
      password?: string;
      reportsToId?: number | null;
    },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { reportsTo: { select: { id: true, username: true } } },
    });
    if (!user || user.organizationId !== organizationId) {
      throw new NotFoundException('用户不存在');
    }
    if (user.role === UserRole.ADMIN) {
      throw new ForbiddenException('不能修改管理员账号');
    }

    if (params.email && params.email !== user.email) {
      const exists = await this.prisma.user.findUnique({ where: { email: params.email } });
      if (exists) throw new ConflictException('邮箱已存在');
    }

    const data: {
      username?: string;
      email?: string;
      role?: UserRole;
      passwordHash?: string;
    } = {};
    if (params.username !== undefined) data.username = params.username.trim();
    if (params.email !== undefined) data.email = params.email.trim().toLowerCase();
    if (params.role !== undefined) data.role = params.role;
    const newPassword = params.password?.trim();
    if (newPassword && newPassword.length >= 6) {
      data.passwordHash = await bcrypt.hash(newPassword, 10);
    }
    if (params.reportsToId !== undefined) {
      await this.assertValidReportsTo_(params.reportsToId, id, organizationId);
    }

    const updateData: typeof data & { reportsToId?: number | null } = { ...data };
    if (params.reportsToId !== undefined) {
      updateData.reportsToId = params.reportsToId;
    }

    if (Object.keys(updateData).length === 0) {
      return {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        isActive: user.isActive,
        reportsToId: user.reportsToId,
        reportsTo: user.reportsTo,
      };
    }

    return this.prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        isActive: true,
        reportsToId: true,
        reportsTo: { select: { id: true, username: true } },
      },
    });
  }
}
