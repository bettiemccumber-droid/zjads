import {
  AdDraft,
  AdPromotionAsset,
  languageConstant,
  normalizeStructuredSnippetHeader,
  usdToMicros,
} from './ads-automation.util';

/**
 * 组装将来要发给 Google Ads API v26 的原子创建请求。
 * 本地系列状态保持待提交；报文里的 ENABLED 只在真正发送时生效。
 * finalUrls 使用商家网址。
 */
export function buildCreateCampaignPayload(input: {
  customerId: string;
  campaignName: string;
  draft: AdDraft;
  /** 已下载的图片 base64；有则挂到系列 AD_IMAGE。 */
  imageAssets?: Array<{ name: string; data: string }>;
  /** 已下载的商标 base64；有则挂到系列 LOGO。 */
  logoAssets?: Array<{ name: string; data: string }>;
}): Record<string, unknown> {
  const customerId = input.customerId.replace(/-/g, '');
  const budget = `customers/${customerId}/campaignBudgets/-1`;
  const campaign = `customers/${customerId}/campaigns/-2`;
  const adGroup = `customers/${customerId}/adGroups/-3`;
  const ceilingRaw = input.draft.cpcBidCeilingUsd?.trim() || '';
  const ceiling = ceilingRaw ? usdToMicros(ceilingRaw) : '';
  const operations: Record<string, unknown>[] = [];

  operations.push({
    campaignBudgetOperation: {
      create: {
        resourceName: budget,
        name: `${input.campaignName} budget`,
        deliveryMethod: 'STANDARD',
        amountMicros: usdToMicros(input.draft.dailyBudgetUsd),
        explicitlyShared: false,
      },
    },
  });

  const campaignCreate: Record<string, unknown> = {
    resourceName: campaign,
    name: input.campaignName,
    status: 'ENABLED',
    advertisingChannelType: 'SEARCH',
    campaignBudget: budget,
    networkSettings: {
      targetGoogleSearch: true,
      targetSearchNetwork: false,
      targetContentNetwork: false,
      targetPartnerSearchNetwork: false,
    },
    containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
  };
  if (input.draft.finalUrlSuffix) {
    campaignCreate.finalUrlSuffix = input.draft.finalUrlSuffix;
  }
  if (input.draft.bidding === 'MANUAL_CPC') {
    campaignCreate.manualCpc = {};
  } else {
    // Maximize Clicks 在 API 里对应 targetSpend；最高 CPC 可选，平时可不设。
    const targetSpend: Record<string, unknown> = {};
    if (ceiling) targetSpend.cpcBidCeilingMicros = ceiling;
    campaignCreate.targetSpend = targetSpend;
  }
  operations.push({ campaignOperation: { create: campaignCreate } });

  operations.push({
    campaignCriterionOperation: {
      create: {
        campaign,
        location: { geoTargetConstant: `geoTargetConstants/${input.draft.geoTargetId}` },
      },
    },
  });

  const language = languageConstant(input.draft.languageCode);
  if (language) {
    operations.push({
      campaignCriterionOperation: {
        create: {
          campaign,
          language: { languageConstant: `languageConstants/${language}` },
        },
      },
    });
  }

  for (const keyword of input.draft.negativeKeywords) {
    operations.push({
      campaignCriterionOperation: {
        create: {
          campaign,
          negative: true,
          keyword: { text: keyword.text, matchType: keyword.matchType },
        },
      },
    });
  }

  const adGroupCreate: Record<string, unknown> = {
    resourceName: adGroup,
    name: input.campaignName,
    campaign,
    status: 'ENABLED',
    type: 'SEARCH_STANDARD',
  };
  if (input.draft.bidding === 'MANUAL_CPC') {
    adGroupCreate.cpcBidMicros = ceiling || usdToMicros('0.50');
  }
  operations.push({ adGroupOperation: { create: adGroupCreate } });

  for (const keyword of input.draft.keywords) {
    operations.push({
      adGroupCriterionOperation: {
        create: {
          adGroup,
          status: 'ENABLED',
          keyword: { text: keyword.text, matchType: keyword.matchType },
        },
      },
    });
  }

  input.draft.sitelinks.forEach((link, index) => {
    const asset = `customers/${customerId}/assets/-${10 + index}`;
    operations.push({
      assetOperation: {
        create: {
          resourceName: asset,
          finalUrls: [link.finalUrl],
          sitelinkAsset: {
            linkText: link.linkText,
            description1: link.description1,
            description2: link.description2,
          },
        },
      },
    });
    operations.push({
      campaignAssetOperation: {
        create: { asset, campaign, fieldType: 'SITELINK' },
      },
    });
  });

  input.draft.callouts.forEach((text, index) => {
    const asset = `customers/${customerId}/assets/-${40 + index}`;
    operations.push({
      assetOperation: {
        create: {
          resourceName: asset,
          calloutAsset: { calloutText: text },
        },
      },
    });
    operations.push({
      campaignAssetOperation: {
        create: { asset, campaign, fieldType: 'CALLOUT' },
      },
    });
  });

  (input.draft.structuredSnippets ?? []).forEach((snippet, index) => {
    const header = normalizeStructuredSnippetHeader(snippet.header);
    const values = (snippet.values ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 10);
    if (!header || values.length < 3) return;
    const asset = `customers/${customerId}/assets/-${60 + index}`;
    operations.push({
      assetOperation: {
        create: {
          resourceName: asset,
          structuredSnippetAsset: {
            header,
            values,
          },
        },
      },
    });
    operations.push({
      campaignAssetOperation: {
        create: { asset, campaign, fieldType: 'STRUCTURED_SNIPPET' },
      },
    });
  });

  const promotionOps = buildPromotionAssetOperations({
    customerId,
    campaign,
    draft: input.draft,
  });
  operations.push(...promotionOps);
  operations.push(...buildAdImageAssetOperations({
    customerId,
    campaign,
    images: input.imageAssets ?? [],
    fieldType: 'AD_IMAGE',
    assetOffset: 100,
  }));
  operations.push(...buildAdImageAssetOperations({
    customerId,
    campaign,
    images: input.logoAssets ?? [],
    fieldType: 'LOGO',
    assetOffset: 200,
    max: 5,
  }));

  operations.push({
    adGroupAdOperation: {
      create: {
        status: 'ENABLED',
        adGroup,
        ad: {
          finalUrls: [input.draft.merchantUrl],
          responsiveSearchAd: {
            headlines: input.draft.headlines.map((text) => ({ text })),
            descriptions: input.draft.descriptions.map((text) => ({ text })),
          },
        },
      },
    },
  });

  return {
    partialFailure: false,
    validateOnly: false,
    mutateOperations: operations,
  };
}

/**
 * 搜索广告图片 / 商标素材。fieldType 为 AD_IMAGE 或 LOGO；无图时返回空。
 */
function buildAdImageAssetOperations(input: {
  customerId: string;
  campaign: string;
  images: Array<{ name: string; data: string }>;
  fieldType: 'AD_IMAGE' | 'LOGO';
  assetOffset: number;
  max?: number;
}): Record<string, unknown>[] {
  const ops: Record<string, unknown>[] = [];
  const label = input.fieldType === 'LOGO' ? 'Logo' : 'Ad image';
  input.images.slice(0, input.max ?? 20).forEach((image, index) => {
    if (!image.data) return;
    const asset = `customers/${input.customerId}/assets/-${input.assetOffset + index}`;
    ops.push({
      assetOperation: {
        create: {
          resourceName: asset,
          name: (image.name || `${label} ${index + 1}`).slice(0, 128),
          type: 'IMAGE',
          imageAsset: { data: image.data },
        },
      },
    });
    ops.push({
      campaignAssetOperation: {
        create: { asset, campaign: input.campaign, fieldType: input.fieldType },
      },
    });
  });
  return ops;
}

/**
 * 可选促销附加信息 → Google Ads PROMOTION asset。
 */
function buildPromotionAssetOperations(input: {
  customerId: string;
  campaign: string;
  draft: AdDraft;
}): Record<string, unknown>[] {
  const assetData = input.draft.promotionAsset;
  if (!assetData?.enabled) return [];
  const promotionAsset = toGooglePromotionAsset(assetData, input.draft);
  if (!promotionAsset) return [];
  const resourceName = `customers/${input.customerId}/assets/-80`;
  const finalUrl = (assetData.finalUrl || input.draft.merchantUrl || '').trim();
  return [
    {
      assetOperation: {
        create: {
          resourceName,
          finalUrls: [finalUrl],
          promotionAsset,
        },
      },
    },
    {
      campaignAssetOperation: {
        create: { asset: resourceName, campaign: input.campaign, fieldType: 'PROMOTION' },
      },
    },
  ];
}

function toGooglePromotionAsset(
  asset: AdPromotionAsset,
  draft: AdDraft,
): Record<string, unknown> | null {
  const promotionTarget = asset.promotionTarget?.trim();
  if (!promotionTarget) return null;
  const body: Record<string, unknown> = {
    promotionTarget,
    languageCode: (asset.languageCode || draft.languageCode || 'en').replace(/_/g, '-'),
  };
  if (asset.discountType === 'PERCENT') {
    const percent = Number(asset.percentOff);
    if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null;
    body.percentOff = Math.round(percent * 10_000);
  } else {
    const amount = asset.moneyAmountOff?.trim();
    if (!amount) return null;
    body.moneyAmountOff = {
      currencyCode: (asset.currencyCode || 'USD').trim().toUpperCase(),
      amountMicros: usdToMicros(amount),
    };
  }
  if (asset.promotionCode?.trim()) body.promotionCode = asset.promotionCode.trim();
  if (asset.ordersOverAmount?.trim()) {
    body.ordersOverAmount = {
      currencyCode: (asset.currencyCode || 'USD').trim().toUpperCase(),
      amountMicros: usdToMicros(asset.ordersOverAmount.trim()),
    };
  }
  if (asset.occasion?.trim() && asset.occasion.trim().toUpperCase() !== 'NONE') {
    body.occasion = asset.occasion.trim().toUpperCase().replace(/\s+/g, '_');
  }
  if (asset.startDate?.trim()) body.startDate = asset.startDate.trim();
  if (asset.endDate?.trim()) body.endDate = asset.endDate.trim();
  return body;
}
