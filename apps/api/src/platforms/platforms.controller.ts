import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ok } from '../common/api-response';
import { PlatformsService } from './platforms.service';

@Controller('platforms')
@UseGuards(AuthGuard('jwt'))
export class PlatformsController {
  constructor(private readonly platforms: PlatformsService) {}

  @Get()
  async list() {
    return ok(await this.platforms.listEnabled());
  }
}
