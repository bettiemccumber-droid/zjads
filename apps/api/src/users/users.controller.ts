import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { ok } from '../common/api-response';
import { AuthUser } from '../common/ownership.util';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UsersService } from './users.service';

class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsEnum(UserRole)
  role!: UserRole;
}

class SetActiveDto {
  @IsBoolean()
  isActive!: boolean;
}

class UpdateUserDto {
  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;
}

@Controller('admin/users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    return ok(await this.users.list(user.organizationId));
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateUserDto) {
    const data = await this.users.create({
      organizationId: user.organizationId,
      ...dto,
    });
    return ok(data, '创建成功');
  }

  @Patch(':id/active')
  async setActive(@Param('id', ParseIntPipe) id: number, @Body() dto: SetActiveDto) {
    return ok(await this.users.setActive(id, dto.isActive));
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ) {
    const data = await this.users.update(id, user.organizationId, dto);
    return ok(data, '更新成功');
  }
}
