import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NormalizedStatus } from '@prisma/client';
import { ok } from '../common/api-response';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../common/ownership.util';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(AuthGuard('jwt'))
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return ok(
      await this.orders.list(user, {
        startDate: query.startDate,
        endDate: query.endDate,
        userId: query.userId ? parseInt(query.userId, 10) : undefined,
        channelAccountId: query.channelAccountId
          ? parseInt(query.channelAccountId, 10)
          : undefined,
        normalizedStatus: query.status as NormalizedStatus | undefined,
        merchantId: query.merchantId,
        merchantName: query.merchantName,
        externalOrderId: query.orderId,
        page: query.page ? parseInt(query.page, 10) : 1,
        pageSize: query.pageSize ? parseInt(query.pageSize, 10) : 20,
      }),
    );
  }

  @Get('settlement/merchant-summary')
  async settlementSummary(@CurrentUser() user: AuthUser, @Query() query: Record<string, string>) {
    return ok(
      await this.orders.settlementMerchantSummary(user, {
        startDate: query.startDate,
        endDate: query.endDate,
        userId: query.userId ? parseInt(query.userId, 10) : undefined,
        channelAccountId: query.channelAccountId
          ? parseInt(query.channelAccountId, 10)
          : undefined,
        platformCode: query.platformCode,
      }),
    );
  }
}
