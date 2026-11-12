import { AdDraft, languageConstant, usdToMicros } from './ads-automation.util';

/**
 * 组装将来要发给 Google Ads API v26 的原子创建请求。
 * 本地系列状态保持待提交；报文里的 ENABLED 只在真正发送时生效。
 * finalUrls 使用商家网址。
 */
export function buildCreateCampaignPayload(input: {
  customerId: string;
  campaignName: string;
  draft: AdDraft;
}): Record<string, unknown> {
  const customerId = input.customerId.replace(/-/g, '');
  const budget = `customers/${customerId}/campaignBudgets/-1`;
  const campaign = `customers/${customerId}/campaigns/-2`;
  const adGroup = `customers/${customerId}/adGroups/-3`;
  const ceiling = usdToMicros(input.draft.cpcBidCeilingUsd);
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
    campaignCreate.maximizeClicks = { cpcBidCeilingMicros: ceiling };
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
    adGroupCreate.cpcBidMicros = ceiling;
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
