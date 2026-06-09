const fs = require('fs');
const path = require('path');

const transcriptPath =
  'C:/Users/Administrator/.cursor/projects/d-Code-zjads/agent-transcripts/ed46dbdb-815d-449d-8257-c36a7c3c22ca/ed46dbdb-815d-449d-8257-c36a7c3c22ca.jsonl';

const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
let script = '';

for (const line of lines) {
  if (!line.trim()) continue;
  try {
    const obj = JSON.parse(line);
    const text = obj.role === 'user' && obj.message?.content?.[0]?.text;
    if (
      text &&
      text.includes('@fileoverview Google Ads Script') &&
      text.includes('diagnoseCampaignCounts_')
    ) {
      const m = text.match(/<user_query>\s*([\s\S]*?)\s*$/);
      if (m) script = m[1].trim();
      break;
    }
  } catch {
    // ignore
  }
}

if (!script) {
  console.error('script not found in transcript');
  process.exit(1);
}

function mustReplace(label, oldStr, newStr) {
  if (!script.includes(oldStr)) {
    console.error('PATCH FAILED:', label);
    process.exit(1);
  }
  script = script.replace(oldStr, newStr);
}

mustReplace(
  'header',
  '两阶段采集：先诊断（统计各账户 ENABLED campaign 数）→ 再采集有数据的账户。',
  '两阶段采集：先诊断（统计各账户 non-REMOVED campaign 数）→ 再采集（含全 PAUSED 账户的历史报告）。',
);

mustReplace(
  'changelog',
  ' *   4. 也可单独运行 runMonthlyCostSummary()',
  ` * 
 * 【v11.1 变更】
 *   - 诊断改为统计 campaign.status != REMOVED（不再仅数 ENABLED）。
 *   - 0 个 ENABLED 的子账户仍采集 collectReportRows_ 历史广告报告（修复 wherelight 类漏数）。
 *
 *   4. 也可单独运行 runMonthlyCostSummary()`,
);

mustReplace(
  'diagnose jsdoc',
  ' * 对每个账户执行轻量查询，统计 ENABLED campaign 数量，同时缓存账户名称。',
  ' * 对每个账户执行轻量查询，统计 non-REMOVED campaign 数量，同时缓存账户名称。',
);

mustReplace(
  'diagnose query',
  "SELECT campaign.id FROM campaign WHERE campaign.status = 'ENABLED'",
  "SELECT campaign.id FROM campaign WHERE campaign.status != 'REMOVED'",
);

mustReplace(
  'diagnose log positive',
  " + count + ' enabled campaigns');",
  " + count + ' campaigns (non-removed)');",
);

mustReplace(
  'diagnose log zero',
  " + nameCache[accountId] + '): 0 enabled campaigns (跳过)');",
  " + nameCache[accountId] + '): 0 campaigns (non-removed)');",
);

mustReplace(
  'main diag summary',
  "console.log('诊断完成: 有ENABLED广告系列=' + withCampaigns +",
  "console.log('诊断完成: 有campaign(non-removed)=' + withCampaigns +",
);

mustReplace(
  'init skip',
  `        if (diag.enabledCount === 0) {
          console.log('  [' + (i + 1) + '/' + state.accountIds.length + '] CID=' + accountId +
            ' (' + acctName + ') → 跳过(无广告系列)');
          collectCursor = i + 1;
          state.cursor = collectCursor;
          state.collectCursor = collectCursor;
          state.pendingAccountId = '';
          state.pendingStartDate = '';
          state.pendingEndDate = '';
          saveStateToSheet_(ss, state);
          continue;
        }

        console.log('  [' + (i + 1) + '/' + state.accountIds.length + '] CID=' + accountId +
          ' (' + acctName + ') enabled_campaigns=' + diag.enabledCount);`,
  `        if (diag.enabledCount === 0) {
          console.log('  [' + (i + 1) + '/' + state.accountIds.length + '] CID=' + accountId +
            ' (' + acctName + ') → 0 ENABLED，仍采集历史广告报告');
        } else {
          console.log('  [' + (i + 1) + '/' + state.accountIds.length + '] CID=' + accountId +
            ' (' + acctName + ') campaigns(non-removed)=' + diag.enabledCount);
        }`,
);

mustReplace(
  'daily skip',
  `        if (diag.enabledCount === 0) {
          console.log('  [' + (i + 1) + '/' + state.accountIds.length + '] CID=' + accountId +
            ' (' + acctName + ') → 无ENABLED广告系列，仅采集预算快照');
          try {
            selectAccountById_(accountId, state.mode);
            var pausedBudgetRows = collectBudgetSnapshotRows_(
              state.timezone, accountId, acctName
            );
            pushAll_(allBudgetSnapshotRows, pausedBudgetRows);
            pausedSnapshotAccountIds.push(accountId);
            console.log('    budget_rows=' + pausedBudgetRows.length);
          } catch (snapErr) {
            console.log('    ⚠️ 预算快照采集失败(非致命): ' + toErrMsg_(snapErr));
          }
          collectCursor = i + 1;
          continue;
        }

        console.log('  [' + (i + 1) + '/' + state.accountIds.length + '] CID=' + accountId +
          ' (' + acctName + ') enabled_campaigns=' + diag.enabledCount);`,
  `        if (diag.enabledCount === 0) {
          console.log('  [' + (i + 1) + '/' + state.accountIds.length + '] CID=' + accountId +
            ' (' + acctName + ') → 0 ENABLED，仍采集历史广告报告 + 预算快照');
        } else {
          console.log('  [' + (i + 1) + '/' + state.accountIds.length + '] CID=' + accountId +
            ' (' + acctName + ') campaigns(non-removed)=' + diag.enabledCount);
        }`,
);

mustReplace(
  'config lookback default',
  "['lookback_days', String(DEFAULT_LOOKBACK_DAYS), '回补天数（截止昨天；0=初始化模式，采集全部历史）'],",
  "['lookback_days', '7', '回补天数（截止昨天；0=初始化模式；日常建议7）'],",
);

const outDir = path.join(__dirname, '..', 'docs');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'google-ads-mcc-sheet-script.gs');
fs.writeFileSync(outPath, script, 'utf8');

console.log('written:', outPath);
console.log('lines:', script.split('\n').length);
console.log('bytes:', script.length);
