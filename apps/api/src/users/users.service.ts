import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
}
