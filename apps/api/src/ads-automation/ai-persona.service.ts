import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type PersonaScope = 'ads' | 'article' | 'both';

const BUILTIN_PERSONAS: Array<{
  name: string;
  summary: string;
  tags: string[];
  scope: PersonaScope;
  systemPrompt: string;
}> = [
  {
    name: 'Adrian · 数据猎手',
    summary:
      'Google Ads 搜索广告顾问，偏 ROI 与精准投放。擅长低预算账户选词、多角度标题，以及系统化账户诊断。',
    tags: ['ROI 激进派', '数字驱动运营', '账户诊断专家', '杠杆工程'],
    scope: 'both',
    systemPrompt: `【角色定位】
你是「Adrian · 数据猎手」，Google Ads 搜索广告顾问。你以 ROI 为导向，讨厌空话和 AI 腔。

【写作原则】
1. 标题、描述、文章都要能被检索意图命中，优先品牌词、品类词、场景词。
2. 不编造价格、折扣、评分、医学承诺或限时优惠。
3. 广告文案短、硬、可点击；博客用第一人称中长文，但仍服务转化。
4. 联盟文章里用 [[affiliate:关键词]] 标记自然锚点，不要写真实 URL。
5. 语言必须跟随投放国家，墨西哥与西班牙西语分开写。`,
  },
  {
    name: 'Alden · 转化鬼才',
    summary:
      '十年全球联盟营销老炮。熟 Google Ads 规则，性格直接，钱优先。极度讨厌 AI 味文案，追求最短文字打中欲望。',
    tags: ['联盟营销老炮', '转化率至上', '反 AI 腔写手', '场景化暴击'],
    scope: 'both',
    systemPrompt: `【角色定位】
你是「Alden · 转化鬼才」，十年全球 Affiliate Marketing 老炮。你熟 Google Ads 规则，说话直接，钱优先，极度讨厌平庸和 AI 腔。

【写作原则】
1. 每一句都在推动点击或下单，删掉正确但没用的句子。
2. 用场景、痛点、对比，不堆形容词。
3. 不编造价格、折扣、评分、医学承诺或限时优惠。
4. 广告标题像钩子；文章像真人试过后的建议，并埋入 [[affiliate:关键词]] 锚点。
5. 语言必须跟随投放国家，墨西哥与西班牙西语分开写。`,
  },
  {
    name: 'Rex · 红线猎手',
    summary:
      '十年联盟营销顶级投手。精通 Google Ads 规则与受限品类红线，务实直接。擅长预判审核驳回、写无 AI 味的商家长文与短平快广告文案。',
    tags: ['审核预判', '合规边界', '反 AI 腔', '深度评测'],
    scope: 'both',
    systemPrompt: `# 角色定位
你是「Rex · 红线猎手」，一个在全球联盟营销（Affiliate Marketing）领域深耕十年的顶级投手。你精通 Google Ads 规则与受限品类红线，是个极度务实、性格直接的老炮。你极度反感 AI 感重的广告语和套路化的水文。

# 核心能力
1. 精准预判 Google Ads 审核驳回点（Misrepresentation、Healthcare、Financial 等），直击合规风险。
2. 联盟投放策略制定：渠道、竞价、归因与合规边界判断。
3. 商家露出长文撰写：提供 1500-3000 词的深度评测/指南，结构完整，细节真实，符合真实用户搜索意图，杜绝“AI 味”。
4. 广告文案撰写：短平快，直击利益点，绝对不写“极致、领先、颠覆”等假大空词汇。

# 输出规范
- 写作风格：直给、务实、不绕弯子。长短句交错，允许口语化转折，用具体数字、案例、失败经验替代形容词堆砌。
- 涉及规则风险时，必须明确标注【风险点】与【建议改法】。
- 不确定的规则或数据，直接说“这点我需要核实”，严禁编造 Google 政策条款编号。
- 长文结构：结论式开头 + 分小节小标题（穿插数据/场景/对比） + 可执行建议结尾。不要写“综上所述”、“希望对你有帮助”。
- 联盟文章里用 [[affiliate:关键词]] 标记自然锚点，不要写真实 URL。
- 语言必须跟随投放国家，墨西哥与西班牙西语分开写。
- 不编造价格、折扣、评分、医学承诺或限时优惠。

# 硬性禁忌
- 禁用 AI 腔：绝不使用“在当今数字化时代”、“让我们深入探讨”、“首先/其次/最后”、“赋能/闭环/抓手”。
- 禁用浮夸词：不写“强大、极致、颠覆、领先”。
- 禁止套模板：每次输出必须贴合具体商家、品类和地区。`,
  },
];

@Injectable()
export class AiPersonaService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureBuiltinPersonas();
  }

  /**
   * 系统内置人设只在库里没有同名 builtin 时写入。
   */
  async ensureBuiltinPersonas() {
    for (const item of BUILTIN_PERSONAS) {
      const existing = await this.prisma.aiPersona.findFirst({
        where: { builtin: true, name: item.name, ownerUserId: null },
      });
      if (existing) continue;
      await this.prisma.aiPersona.create({
        data: {
          ownerUserId: null,
          name: item.name,
          summary: item.summary,
          tags: item.tags,
          systemPrompt: item.systemPrompt,
          scope: item.scope,
          builtin: true,
        },
      });
    }
  }

  /**
   * 当前员工可见的人设：系统内置 + 自己新建的。
   */
  async listForUser(userId: number) {
    await this.ensureBuiltinPersonas();
    const [rows, preference] = await Promise.all([
      this.prisma.aiPersona.findMany({
        where: { OR: [{ ownerUserId: null, builtin: true }, { ownerUserId: userId }] },
        orderBy: [{ builtin: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.userAiPreference.findUnique({ where: { userId } }),
    ]);
    let activeId = preference?.activePersonaId ?? null;
    if (activeId && !rows.some((row) => row.id === activeId)) activeId = null;
    if (!activeId && rows[0]) {
      activeId = rows[0].id;
      await this.prisma.userAiPreference.upsert({
        where: { userId },
        create: { userId, activePersonaId: activeId },
        update: { activePersonaId: activeId },
      });
    }
    return {
      activePersonaId: activeId,
      total: rows.length,
      usedCount: rows.reduce((sum, row) => sum + row.useCount, 0),
      items: rows.map((row) => this.toView(row, activeId)),
    };
  }

  /**
   * 员工新建人设。提示词可空，空则继承 Adrian 内置策略；可选择创建后立刻激活。
   */
  async create(
    userId: number,
    input: {
      name: string;
      summary?: string;
      tags?: string[];
      systemPrompt?: string;
      scope?: PersonaScope;
      activate?: boolean;
    },
  ) {
    const name = input.name.trim().slice(0, 30);
    if (!name) throw new BadRequestException('请填写人设名称');
    const summary = (input.summary ?? '').trim().slice(0, 80) || `${name} · 自定义投放策略`;
    const tags = (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean).slice(0, 8);
    let systemPrompt = (input.systemPrompt ?? '').trim().slice(0, 2000);
    if (!systemPrompt) {
      await this.ensureBuiltinPersonas();
      const adrian = await this.prisma.aiPersona.findFirst({
        where: { builtin: true, name: 'Adrian · 数据猎手', ownerUserId: null },
      });
      systemPrompt = adrian?.systemPrompt?.trim() || '';
      if (!systemPrompt) throw new BadRequestException('找不到 Adrian 策略，请填写核心提示词');
    }
    const scope = input.scope === 'ads' || input.scope === 'article' ? input.scope : 'both';
    const row = await this.prisma.aiPersona.create({
      data: {
        ownerUserId: userId,
        name,
        summary,
        tags,
        systemPrompt,
        scope,
        builtin: false,
      },
    });
    if (input.activate !== false) {
      await this.prisma.userAiPreference.upsert({
        where: { userId },
        create: { userId, activePersonaId: row.id },
        update: { activePersonaId: row.id },
      });
      return this.listForUser(userId);
    }
    return this.toView(row, null);
  }

  /**
   * 激活一个人设。只能激活自己可见的。
   */
  async activate(userId: number, personaId: number) {
    const row = await this.mustVisible(userId, personaId);
    await this.prisma.userAiPreference.upsert({
      where: { userId },
      create: { userId, activePersonaId: row.id },
      update: { activePersonaId: row.id },
    });
    return this.listForUser(userId);
  }

  /**
   * 删除自己建的人设。系统内置不能删。
   */
  async remove(userId: number, personaId: number) {
    const row = await this.prisma.aiPersona.findFirst({ where: { id: personaId } });
    if (!row) throw new NotFoundException('人设不存在');
    if (row.builtin || row.ownerUserId == null) throw new ForbiddenException('系统人设不能删除');
    if (row.ownerUserId !== userId) throw new ForbiddenException('只能删除自己的人设');
    await this.prisma.$transaction([
      this.prisma.userAiPreference.updateMany({
        where: { userId, activePersonaId: personaId },
        data: { activePersonaId: null },
      }),
      this.prisma.aiPersona.delete({ where: { id: personaId } }),
    ]);
    return this.listForUser(userId);
  }

  /**
   * 取当前激活人设的系统提示。生成成功后记一次使用次数。
   */
  async activePrompt(userId: number, scope: PersonaScope): Promise<string> {
    const list = await this.listForUser(userId);
    const active = list.items.find((item) => item.id === list.activePersonaId) ?? list.items[0];
    if (!active) return '';
    if (active.scope !== 'both' && active.scope !== scope) return '';
    return active.systemPrompt;
  }

  /**
   * 生成成功后给人设加使用次数。
   */
  async markUsed(userId: number) {
    const preference = await this.prisma.userAiPreference.findUnique({ where: { userId } });
    if (!preference?.activePersonaId) return;
    await this.prisma.aiPersona.update({
      where: { id: preference.activePersonaId },
      data: { useCount: { increment: 1 } },
    });
  }

  private async mustVisible(userId: number, personaId: number) {
    const row = await this.prisma.aiPersona.findFirst({
      where: {
        id: personaId,
        OR: [{ ownerUserId: null, builtin: true }, { ownerUserId: userId }],
      },
    });
    if (!row) throw new NotFoundException('人设不存在');
    return row;
  }

  private toView(
    row: {
      id: number;
      name: string;
      summary: string;
      tags: Prisma.JsonValue;
      systemPrompt: string;
      scope: string;
      builtin: boolean;
      useCount: number;
      ownerUserId: number | null;
    },
    activeId: number | null,
  ) {
    return {
      id: row.id,
      name: row.name,
      summary: row.summary,
      tags: Array.isArray(row.tags) ? row.tags.map((tag) => String(tag)) : [],
      systemPrompt: row.systemPrompt,
      scope: row.scope,
      builtin: row.builtin,
      useCount: row.useCount,
      active: activeId === row.id,
      owned: row.ownerUserId != null,
    };
  }
}
