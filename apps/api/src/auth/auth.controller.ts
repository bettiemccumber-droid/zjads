import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { ok } from '../common/api-response';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from '../common/ownership.util';

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto) {
    const data = await this.auth.login(dto.email, dto.password);
    return ok(data);
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async me(@CurrentUser() user: AuthUser) {
    const data = await this.auth.getMe(user.id);
    return ok(data);
  }
}
