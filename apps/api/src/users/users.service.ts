import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
  async update(
    id: number,
    organizationId: number,
    params: {
      username?: string;
      email?: string;
      role?: UserRole;
      password?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id } });
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
    if (params.username !== undefined) data.username = params.username;
    if (params.email !== undefined) data.email = params.email;
    if (params.role !== undefined) data.role = params.role;
    if (params.password) {
      data.passwordHash = await bcrypt.hash(params.password, 10);
    }

    if (Object.keys(data).length === 0) {
      return {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        isActive: user.isActive,
      };
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        isActive: true,
      },
    });
  }
}
