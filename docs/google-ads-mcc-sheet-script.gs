/**
 * @fileoverview Google Ads Script（MCC/单账户）采集广告数据到 Google Sheets。
 * @description
 * 统一脚本，通过 config 表的 lookback_days 参数自动切换运行模式：
 *
 *   lookback_days > 0 → 日常增量采集模式（建议7天回溯窗口）
 *   lookback_days = 0 → 全量历史初始化模式（从 2000-01-01 到今天）
 *
 * 【日常模式】
 *   - 先批量采集所有账户数据到内存，再安全覆写到 Sheet（不使用 clear，防崩溃丢数据）。
 *   - 搜索字词仅采集今日，每周期清空重写，不保留历史。
 *   - cursor 仅在全部写入成功后推进，保证跨表一致性。
 *
 * 【初始化模式】
 *   - 逐账户采集并立即追加写入，cursor 每账户推进（适合大数据量场景）。
 *   - 搜索字词仅采集今日，与日常模式保持一致。
 *   - 50000 行截断检测保护，防止 Google Ads Scripts 静默截断。
 *   - 搜索字词采集失败为非致命错误（与日常模式一致），不影响广告/关键词数据。
 *   - 建议 max_retention_days 设为 0（不限），避免初始化数据被清理。
 *
 * 【通用特性】
 *   - 两阶段采集：先诊断（统计各账户 non-REMOVED campaign 数）→ 再采集（含全 PAUSED 账户的历史报告）。
 *   - 四张数据表：raw_daily_report（广告级）、raw_daily_keywords（关键词级）、raw_daily_search_terms（搜索字词级）、campaign_budget_snapshots（预算快照级）。
 *   - 采集函数主查询失败直接抛错，不标记"已处理"，保留旧数据避免静默丢失。
 *   - 严格 28 分钟时间控制 + Sheet 断点续跑 + 全链路日志 + 邮件告警。
 *
 * 使用方式：
 *   1. 部署前修改 SPREADSHEET_URL。
 *   2. 初始化：config 表设 lookback_days=0，运行 main() 直到全部完成。
 *      main() 完成原始数据采集后会自动执行 runMonthlyCostSummary() 采集月度广告费。
 *   3. 日常采集：改 lookback_days=7（或其它正整数），设定每日触发器运行 main()。
 *      main() 完成日常采集后会自动执行月度广告费汇总。
 * 
 * 【v11.1 变更】
 *   - 诊断改为统计 campaign.status != REMOVED（不再仅数 ENABLED）。
 *   - 0 个 ENABLED 的子账户仍采集 collectReportRows_ 历史广告报告（修复 wherelight 类漏数）。
 *
 *   4. 也可单独运行 runMonthlyCostSummary()，根据 lookback_days 自动切换模式：
 *      - lookback_days=0 → 初始化：从 2025-01-01 至今天全量按月汇总
 *      - lookback_days>0 → 日常：回溯窗口所涉月份的广告费汇总
 */

// =====================================================================
// 配置区域（部署前必须修改 SPREADSHEET_URL）
// =====================================================================
var SPREADSHEET_URL = 'https://docs.google.com/spreadsheets/d/18QiL5T7RqBlRJkgMX89CjkwSwxoq_2XcRGO2y2jyAN4/edit?gid=410469164#gid=410469164';
var MAX_RUNTIME_SECONDS = 28 * 60;
var DEFAULT_LOOKBACK_DAYS = 0;
var MIN_RESERVE_SECONDS = 45;
var WRITE_BATCH_SIZE = 2000;
var DATA_SCHEMA_VER = 11;

var ALL_TIME_START_DATE = '2000-01-01';
var COST_INIT_START_DATE = '2025-01-01';

// =====================================================================
// Sheet 名称
// =====================================================================
var SHEET_REPORT = 'raw_daily_report';
var SHEET_KEYWORDS = 'raw_daily_keywords';
var SHEET_SEARCH_TERMS = 'raw_daily_search_terms';
var SHEET_BUDGET_SNAPSHOTS = 'campaign_budget_snapshots';
var SHEET_MONTHLY_COST = 'monthly_account_cost';
var SHEET_MONTHLY_SUMMARY = 'monthly_account_cost_summary';
var SHEET_MONTHLY_STATE = 'monthly_resume_state';
var SHEET_LOG = 'run_log';
var SHEET_CONFIG = 'config';
var SHEET_STATE = 'resume_state';

// =====================================================================
// 各数据表统一约定：列 0 = date，列 1 = customer_id
// =====================================================================
var COL_DATE = 0;
var COL_CUSTOMER_ID = 1;
var COL_REPORT_CAMPAIGN_ID = 5;
var COL_REPORT_CAMPAIGN_BUDGET = 9;
var COL_BUDGET_SNAPSHOT_CAMPAIGN_ID = 5;

// =====================================================================
// 表头定义
// =====================================================================
var REPORT_HEADERS = [
  'date', 'customer_id', 'customer_name', 'mcc_id', 'currency',
  'campaign_id', 'campaign_name', 'campaign_status', 'channel_type', 'campaign_budget', 'target_country',
  'ad_group_id', 'ad_group_name',
  'ad_id', 'ad_type', 'ad_status', 'final_urls',
  'impressions', 'clicks', 'cost', 'cost_micros',
  'conversions', 'conversions_value',
  'ctr', 'average_cpc', 'search_impression_share',
  'search_budget_lost_is', 'search_rank_lost_is',
  'updated_at'
];

var KEYWORD_HEADERS = [
  'date', 'customer_id', 'customer_name', 'currency',
  'campaign_id', 'campaign_name',
  'ad_group_id', 'ad_group_name',
  'keyword_id', 'keyword_text', 'match_type', 'keyword_status',
  'max_cpc', 'quality_score',
  'impressions', 'clicks', 'cost',
  'conversions', 'conversions_value',
  'ctr', 'average_cpc',
  'updated_at'
];

var SEARCH_TERM_HEADERS = [
  'date', 'customer_id', 'customer_name', 'currency',
  'campaign_id', 'campaign_name',
  'ad_group_id', 'ad_group_name',
  'keyword_text', 'keyword_match_type',
  'search_term', 'search_term_status',
  'impressions', 'clicks', 'cost',
  'conversions', 'conversions_value',
  'ctr', 'average_cpc',
  'updated_at'
];

var BUDGET_SNAPSHOT_HEADERS = [
  'snapshot_date', 'customer_id', 'customer_name', 'mcc_id', 'currency',
  'campaign_id', 'campaign_name', 'campaign_status', 'channel_type', 'campaign_budget',
  'snapshot_time', 'updated_at'
];

var MONTHLY_COST_HEADERS = [
  'month', 'start_date', 'end_date',
  'customer_id', 'customer_name', 'mcc_id', 'currency',
  'cost', 'fetched_at'
];

var MONTHLY_SUMMARY_HEADERS = [
  'month', 'start_date', 'end_date',
  'mcc_id', 'currency',
  'accounts_total', 'accounts_with_cost', 'total_cost',
  'fetched_at'
];

var LOG_HEADERS = [
  'run_id', 'started_at', 'ended_at', 'mode', 'timezone',
  'start_date', 'end_date',
  'accounts_total', 'accounts_with_campaigns', 'accounts_with_data',
  'accounts_skipped_empty', 'accounts_failed',
  'ad_rows_written', 'kw_rows_written', 'st_rows_written',
  'status', 'elapsed_seconds', 'failed_details'
];

// =====================================================================
// 运行态
// =====================================================================
var RUNTIME = { startMs: 0, forcedStop: false, mccId: '' };

// =====================================================================
// 主入口
// =====================================================================
function main() {
  RUNTIME.startMs = new Date().getTime();
  RUNTIME.forcedStop = false;
  RUNTIME.mccId = String(AdsApp.currentAccount().getCustomerId());

  try {
    if (!SPREADSHEET_URL || SPREADSHEET_URL.indexOf('REPLACE_ME') >= 0) {
      throw new Error('请先替换 SPREADSHEET_URL');
    }
    console.log('[1/7] URL 校验通过');

    var ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
    console.log('[2/7] 表格打开: ' + ss.getName());

    ensureSheets_(ss);
    console.log('[3/7] Sheet 就绪');

    var cfg = loadConfig_(ss);
    var isInitMode = (cfg.lookbackDays === 0);

    var mainStateSheet = ss.getSheetByName(SHEET_STATE);
    var mainHasPendingState = mainStateSheet && mainStateSheet.getLastRow() >= 2;
    var monthlyStateSheet = ss.getSheetByName(SHEET_MONTHLY_STATE);
    var monthlyHasPendingState = monthlyStateSheet && monthlyStateSheet.getLastRow() >= 2;

    if (!mainHasPendingState && monthlyHasPendingState) {
      console.log('检测到未完成的月度广告费汇总（原始数据采集已完成），直接续跑月度汇总...');
      runMonthlyCostSummary();
      console.log('========== 脚本结束 ==========');
      return;
    }

    console.log('========== ' + (isInitMode ? '初始化模式' : '日常采集模式') + ' ==========');
    console.log('[4/7] 配置: lookback=' + (isInitMode ? '全部历史' : cfg.lookbackDays + '天') +
      ' retention=' + (cfg.maxRetentionDays === 0 ? '不限' : cfg.maxRetentionDays + '天') +
      ' tz=' + (cfg.timezone || '(auto)') + ' maxRun=' + MAX_RUNTIME_SECONDS + 's' +
      ' kw=' + cfg.enableKeywordReport + ' st=' + cfg.enableSearchTermReport +
      (cfg.enableSearchTermReport ? ' st_min_impr=' + cfg.searchTermMinImpressions +
        ' st_lookback=' + cfg.searchTermLookbackDays + '天' : ''));

    var state = getOrInitState_(ss, cfg, isInitMode);

    var cfgSnap = state.cfgSnapshot || {};
    var useKw = cfgSnap.enableKeywordReport !== undefined ? cfgSnap.enableKeywordReport : cfg.enableKeywordReport;
    var useSt = cfgSnap.enableSearchTermReport !== undefined ? cfgSnap.enableSearchTermReport : cfg.enableSearchTermReport;
    var stMinImpr = cfgSnap.searchTermMinImpressions !== undefined ? cfgSnap.searchTermMinImpressions : cfg.searchTermMinImpressions;
    var stLookbackDays = cfgSnap.searchTermLookbackDays !== undefined ? cfgSnap.searchTermLookbackDays : cfg.searchTermLookbackDays;
    var stStartDate = stLookbackDays > 1 ? shiftDateStr_(state.endDate, -(stLookbackDays - 1)) : state.endDate;

    var isNewCycle = (state.cursor === 0);
    console.log('[5/7] 状态: mode=' + state.mode +
      ' accounts=' + state.accountIds.length +
      ' cursor=' + state.cursor +
      ' window=' + state.startDate + '~' + state.endDate +
      ' newCycle=' + isNewCycle);

    if (state.accountIds.length === 0) {
      console.log('⚠️ 无子账户');
      writeLog_(ss, state, 0, 0, 0, 0, 0, 0, 0, 'no_accounts', '');
      return;
    }

    // ===== 阶段 1：诊断 =====
    console.log('');
    console.log('===== 阶段1: 账户诊断 =====');
    var nameCache = {};
    var diagResults = diagnoseCampaignCounts_(state, nameCache);
    var withCampaigns = 0;
    var emptyAccounts = 0;
    var unknownAccounts = 0;
    for (var d = 0; d < diagResults.length; d++) {
      if (diagResults[d].enabledCount > 0) {
        withCampaigns++;
      } else if (diagResults[d].enabledCount === 0) {
        emptyAccounts++;
      } else {
        unknownAccounts++;
      }
    }
    console.log('诊断完成: 有campaign(non-removed)=' + withCampaigns +
      ' 空账户=' + emptyAccounts +
      ' 诊断未知=' + unknownAccounts +
      ' / 总计' + diagResults.length);

    // ===== 阶段 2 & 3：采集 & 写入 =====
    var adRowsWritten = 0;
    var kwRowsWritten = 0;
    var stRowsWritten = 0;
    var failedCount = 0;
    var failedDetails = [];
    var accountsWithData = 0;
    var firstSampleLogged = false;

    if (isInitMode) {
      // =================================================================
      // 初始化模式：逐账户采集 + 立即写入 + cursor 逐步推进
      // =================================================================
      console.log('');
      console.log('===== 阶段2: 逐账户采集并写入 =====');
      console.log('  ℹ️ 初始化模式预算说明: 历史日期的 campaign_budget 列使用当前预算值（近似），' +
        '精确历史预算请在日常模式运行一段时间后执行 repairHistoricalBudgets() 修复');
      var collectCursor = state.cursor;

      if (isNewCycle) {
        resetInitRawDataSheets_(ss);
      }

      if (state.pendingAccountId && state.cursor < state.accountIds.length &&
          safeStr_(state.pendingAccountId) === safeStr_(state.accountIds[state.cursor])) {
        console.log('  检测到未完成账户，先清理半成品数据: ' + state.pendingAccountId);
        cleanupPendingInitRows_(ss, state, useKw, useSt);
      } else if (state.pendingAccountId) {
        console.log('  检测到过期 pending 状态，已清空: ' + state.pendingAccountId);
        state.pendingAccountId = '';
        state.pendingStartDate = '';
        state.pendingEndDate = '';
        saveStateToSheet_(ss, state);
      }

      for (var i = state.cursor; i < state.accountIds.length; i++) {
        if (shouldStop_('before_account_' + i)) {
          console.log('⛔ 时间不足，停止于 ' + i + '/' + state.accountIds.length);
          break;
        }

        var accountId = state.accountIds[i];
        var diag = diagResults[i] || { enabledCount: -1 };
        var acctName = nameCache[accountId] || accountId;

        if (diag.enabledCount === 0) {
          console.log('  [' + (i + 1) + '/' + state.accountIds.length + '] CID=' + accountId +
            ' (' + acctName + ') → 0 ENABLED，仍采集历史广告报告');
        } else {
          console.log('  [' + (i + 1) + '/' + state.accountIds.length + '] CID=' + accountId +
            ' (' + acctName + ') campaigns(non-removed)=' + diag.enabledCount);
        }

        var stRowCount = 0;
        var budgetSnapshotRowCount = 0;
        try {
          state.pendingAccountId = accountId;
          state.pendingStartDate = state.startDate;
          state.pendingEndDate = state.endDate;
          saveStateToSheet_(ss, state);

          selectAccountById_(accountId, state.mode);

          var budgetSnapshotRows = collectBudgetSnapshotRows_(
            state.timezone, accountId, acctName
          );
          budgetSnapshotRowCount = budgetSnapshotRows.length;

          var budgetAmountMap = {};
          for (var bs = 0; bs < budgetSnapshotRows.length; bs++) {
            var snapCampId = safeStr_(budgetSnapshotRows[bs][5]);
            if (snapCampId) { budgetAmountMap[snapCampId] = budgetSnapshotRows[bs][9]; }
          }
          console.log('    预算快照广告系列=' + Object.keys(budgetAmountMap).length);

          var adRows = collectReportRows_(
            state.startDate, state.endDate, state.timezone, accountId, acctName, budgetAmountMap
          );
          if (adRows.length >= 50000) {
            throw new Error('广告报告查询行数达到 ' + adRows.length + '，疑似被截断，请缩短采集窗口后重试');
          }

          var kwRows = [];
          if (useKw) {
            kwRows = collectKeywordRows_(
              state.startDate, state.endDate, state.timezone, accountId, acctName
            );
            if (kwRows.length >= 50000) {
              throw new Error('关键词报告查询行数达到 ' + kwRows.length + '，疑似被截断，请缩短采集窗口后重试');
            }
          }

          if (adRows.length > 0) {
            removeAccountWindowRows_(
              ss, SHEET_REPORT, REPORT_HEADERS, accountId, state.startDate, state.endDate
            );
            appendRowsToSheet_(ss, SHEET_REPORT, REPORT_HEADERS, adRows);
          }
          adRowsWritten += adRows.length;

          if (budgetSnapshotRows.length > 0) {
            appendRowsToSheet_(ss, SHEET_BUDGET_SNAPSHOTS, BUDGET_SNAPSHOT_HEADERS, budgetSnapshotRows);
          }

          if (kwRows.length > 0) {
            appendRowsToSheet_(ss, SHEET_KEYWORDS, KEYWORD_HEADERS, kwRows);
          }
          kwRowsWritten += kwRows.length;

          if (useSt) {
            try {
              var stRows = collectSearchTermRows_(
                stStartDate, state.endDate, state.timezone, accountId, acctName, stMinImpr
              );
              stRowCount = stRows.length;
              if (stRows.length > 0) {
                appendRowsToSheet_(ss, SHEET_SEARCH_TERMS, SEARCH_TERM_HEADERS, stRows);
              }
              stRowsWritten += stRows.length;
            } catch (stErr) {
              stRowCount = -1;
              console.log('    ⚠️ 搜索字词采集失败(非致命): ' + toErrMsg_(stErr));
            }
          }

          SpreadsheetApp.flush();

          collectCursor = i + 1;
          state.cursor = collectCursor;
          state.collectCursor = collectCursor;
          state.pendingAccountId = '';
          state.pendingStartDate = '';
          state.pendingEndDate = '';
          saveStateToSheet_(ss, state);

          if (adRows.length > 0 || kwRows.length > 0 || stRowCount > 0) {
            accountsWithData++;
          }

          console.log('    ad_rows=' + adRows.length +
            ' budget_rows=' + budgetSnapshotRowCount +
            (useKw ? ' kw_rows=' + kwRows.length : '') +
            (useSt ? ' st_rows=' + (stRowCount >= 0 ? stRowCount : 'ERR') : ''));

          if (!firstSampleLogged && adRows.length > 0) {
            console.log('    [采样] 首行: ' +
              'date=' + adRows[0][0] +
              ' cid=' + adRows[0][1] +
              ' currency=' + adRows[0][4] +
              ' campaign=' + adRows[0][6] +
              ' ad_id=' + adRows[0][12] +
              ' impr=' + adRows[0][17] +
              ' clicks=' + adRows[0][18] +
              ' cost=' + adRows[0][19]);
            firstSampleLogged = true;
          }
        } catch (err) {
          failedCount++;
          var errMsg = '[' + accountId + '] ' + toErrMsg_(err);
          failedDetails.push(errMsg);
          console.log('    ❌ ' + errMsg);
          console.log('    ⚠️ cursor 未推进，下次续跑将先清理此账户半成品数据后重试');
        }
      }

    } else {
      // =================================================================
      // 日常模式：先批量采集所有账户，再统一写入
      // =================================================================
      console.log('');
      console.log('===== 阶段2: 数据采集 =====');
      var allAdRows = [];
      var allKwRows = [];
      var allStRows = [];
      var allBudgetSnapshotRows = [];
      var processedAccountIds = [];
      var pausedSnapshotAccountIds = [];
      var collectCursor = state.cursor;

      for (var i = state.cursor; i < state.accountIds.length; i++) {
        if (shouldStop_('before_account_' + i)) {
          console.log('⛔ 时间不足，停止于 ' + i + '/' + state.accountIds.length);
          break;
        }

        var accountId = state.accountIds[i];
        var diag = diagResults[i] || { enabledCount: -1 };
        var acctName = nameCache[accountId] || accountId;

        if (diag.enabledCount === 0) {
          console.log('  [' + (i + 1) + '/' + state.accountIds.length + '] CID=' + accountId +
            ' (' + acctName + ') → 0 ENABLED，仍采集历史广告报告 + 预算快照');
        } else {
          console.log('  [' + (i + 1) + '/' + state.accountIds.length + '] CID=' + accountId +
            ' (' + acctName + ') campaigns(non-removed)=' + diag.enabledCount);
        }

        var stRowCount = 0;
        try {
          selectAccountById_(accountId, state.mode);

          var budgetSnapshotRows = collectBudgetSnapshotRows_(
            state.timezone, accountId, acctName
          );

          var budgetAmountMap = {};
          for (var bs = 0; bs < budgetSnapshotRows.length; bs++) {
            var snapCampId = safeStr_(budgetSnapshotRows[bs][5]);
            if (snapCampId) { budgetAmountMap[snapCampId] = budgetSnapshotRows[bs][9]; }
          }

          var adRows = collectReportRows_(
            state.startDate, state.endDate, state.timezone, accountId, acctName, budgetAmountMap
          );
          var kwRows = [];
          if (useKw) {
            kwRows = collectKeywordRows_(
              state.startDate, state.endDate, state.timezone, accountId, acctName
            );
          }

          pushAll_(allBudgetSnapshotRows, budgetSnapshotRows);
          pushAll_(allAdRows, adRows);
          pushAll_(allKwRows, kwRows);
          processedAccountIds.push(accountId);
          if (adRows.length > 0) { accountsWithData++; }

          if (useSt) {
            try {
              var stRows = collectSearchTermRows_(
                stStartDate, state.endDate, state.timezone, accountId, acctName, stMinImpr
              );
              stRowCount = stRows.length;
              pushAll_(allStRows, stRows);
            } catch (stErr) {
              stRowCount = -1;
              console.log('    ⚠️ 搜索字词采集失败(非致命): ' + toErrMsg_(stErr));
            }
          }

          console.log('    ad_rows=' + adRows.length +
            ' budget_rows=' + budgetSnapshotRows.length +
            (useKw ? ' kw_rows=' + kwRows.length : '') +
            (useSt ? ' st_rows=' + (stRowCount >= 0 ? stRowCount : 'ERR') : ''));

          if (!firstSampleLogged && adRows.length > 0) {
            console.log('    [采样] 首行: ' +
              'date=' + adRows[0][0] +
              ' cid=' + adRows[0][1] +
              ' currency=' + adRows[0][4] +
              ' campaign=' + adRows[0][6] +
              ' ad_id=' + adRows[0][12] +
              ' impr=' + adRows[0][17] +
              ' clicks=' + adRows[0][18] +
              ' cost=' + adRows[0][19]);
            firstSampleLogged = true;
          }
        } catch (err) {
          failedCount++;
          var errMsg = '[' + accountId + '] ' + toErrMsg_(err);
          failedDetails.push(errMsg);
          console.log('    ❌ ' + errMsg);
        }

        collectCursor = i + 1;
        state.collectCursor = collectCursor;
        saveStateToSheet_(ss, state);
      }

      // ===== 阶段 3：批量写入（仅日常模式） =====
      console.log('');
      console.log('===== 阶段3: 批量写入 =====');
      var budgetSnapshotSummary = summarizeBudgetSnapshotRows_(allBudgetSnapshotRows);
      console.log('  今日预算快照汇总: 账户' + budgetSnapshotSummary.accountCount +
        '个 广告系列' + budgetSnapshotSummary.campaignCount + '个');

      if (shouldStop_('before_write_stage')) {
        console.log('⛔ 写入前时间不足，跳过本次写入，下次续跑将重新处理');
        state.collectCursor = collectCursor;
        saveStateToSheet_(ss, state);
        writeLog_(ss, state, withCampaigns, accountsWithData,
          emptyAccounts + unknownAccounts, failedCount,
          0, 0, 0, 'stopped_by_time_limit', '写入前时间不足');
        if (cfg.alertEmail) {
          sendAlert_(cfg.alertEmail, state.runId, 'stopped_by_time_limit', failedCount,
            failedDetails.concat(['写入前时间不足，已跳过写入']));
        }
        return;
      }

      try {
        var budgetSnapshotAccountIds = processedAccountIds.concat(pausedSnapshotAccountIds);
        if (allBudgetSnapshotRows.length > 0 || budgetSnapshotAccountIds.length > 0) {
          detectBudgetChanges_(ss, allBudgetSnapshotRows, state.timezone);
          bulkWriteWindowData_(
            ss, SHEET_BUDGET_SNAPSHOTS, BUDGET_SNAPSHOT_HEADERS,
            formatDate_(new Date(), state.timezone), formatDate_(new Date(), state.timezone),
            state.retentionCutoff || '',
            allBudgetSnapshotRows, budgetSnapshotAccountIds
          );
          SpreadsheetApp.flush();
          console.log('  预算快照写入: ' + allBudgetSnapshotRows.length + ' 行');
        }

        if (allAdRows.length > 0 || processedAccountIds.length > 0) {
          backfillHistoricalCampaignBudgets_(
            ss, allAdRows, processedAccountIds,
            state.startDate, state.endDate, state.timezone
          );
          adRowsWritten = bulkWriteWindowData_(
            ss, SHEET_REPORT, REPORT_HEADERS,
            state.startDate, state.endDate,
            state.retentionCutoff || '',
            allAdRows, processedAccountIds
          );
          SpreadsheetApp.flush();
          console.log('  广告报告写入: ' + adRowsWritten + ' 行');
        }

        if (useKw && (allKwRows.length > 0 || processedAccountIds.length > 0)) {
          kwRowsWritten = bulkWriteWindowData_(
            ss, SHEET_KEYWORDS, KEYWORD_HEADERS,
            state.startDate, state.endDate,
            state.retentionCutoff || '',
            allKwRows, processedAccountIds
          );
          SpreadsheetApp.flush();
          console.log('  关键词报告写入: ' + kwRowsWritten + ' 行');
        }

        if (useSt && (allStRows.length > 0 || isNewCycle)) {
          stRowsWritten = writeSearchTermData_(ss, allStRows, isNewCycle);
          SpreadsheetApp.flush();
          console.log('  搜索字词报告写入: ' + stRowsWritten + ' 行' +
            (isNewCycle ? ' (新周期，已清空旧数据)' : ' (续跑追加)'));
        }

        if (adRowsWritten === 0 && kwRowsWritten === 0 && stRowsWritten === 0 &&
            processedAccountIds.length === 0) {
          console.log('无新数据，无已处理账户');
        }

        state.cursor = collectCursor;
        state.collectCursor = collectCursor;
        saveStateToSheet_(ss, state);

      } catch (writeErr) {
        state.collectCursor = collectCursor;
        saveStateToSheet_(ss, state);
        if (useSt) {
          try {
            var stSheet = ss.getSheetByName(SHEET_SEARCH_TERMS);
            if (stSheet && stSheet.getLastRow() > 1) {
              stSheet.deleteRows(2, stSheet.getLastRow() - 1);
            }
          } catch (stClearErr) {
            console.log('  ⚠️ 搜索字词清理失败(非致命): ' + toErrMsg_(stClearErr));
          }
        }
        console.log('❌ 写入失败，cursor 未推进，下次续跑将重试: ' + toErrMsg_(writeErr));
        writeLog_(ss, state, withCampaigns, accountsWithData,
          emptyAccounts + unknownAccounts, failedCount,
          adRowsWritten, kwRowsWritten, stRowsWritten,
          'write_error', failedDetails.concat([toErrMsg_(writeErr)]).join(' | '));
        throw writeErr;
      }
    }

    // ===== 收尾 =====
    var status = 'partial';
    if (state.cursor >= state.accountIds.length) {
      status = failedCount > 0 ? 'completed_with_errors' : 'completed';
      clearStateSheet_(ss);
    } else if (RUNTIME.forcedStop) {
      status = 'stopped_by_time_limit';
    }

    writeLog_(ss, state, withCampaigns, accountsWithData,
      emptyAccounts + unknownAccounts, failedCount,
      adRowsWritten, kwRowsWritten, stRowsWritten,
      status, failedDetails.join(' | '));

    if (cfg.alertEmail && status !== 'completed') {
      sendAlert_(cfg.alertEmail, state.runId, status, failedCount, failedDetails);
    }

    // ===== 汇总 =====
    var elapsed = getElapsed_();
    console.log('');
    console.log('===== 运行汇总 =====');
    console.log('状态: ' + status);
    console.log('账户: 总' + state.accountIds.length +
      ' | 有广告系列' + withCampaigns +
      ' | 有数据' + accountsWithData +
      ' | 空' + emptyAccounts +
      ' | 诊断未知' + unknownAccounts +
      ' | 失败' + failedCount);
    console.log('数据: 广告' + adRowsWritten + '行 关键词' + kwRowsWritten +
      '行 搜索字词' + stRowsWritten + '行');
    if (isInitMode) {
      console.log('进度: ' + state.cursor + '/' + state.accountIds.length + ' 账户已完成');
    }
    console.log('耗时: ' + elapsed + 's');
    console.log('[6/7] 日志已写入');
    console.log('[7/7] 完成');

    if (isInitMode && status !== 'completed' && status !== 'completed_with_errors') {
      console.log('');
      console.log('⏳ 原始数据尚未采集完毕，请再次运行 main() 继续（已自动保存断点）。');
    }

    if (!shouldStop_('before_monthly_cost')) {
      console.log('');
      console.log('===== 自动执行月度广告费汇总 =====');
      try {
        runMonthlyCostSummary();
      } catch (monthlyErr) {
        console.log('⚠️ 月度广告费汇总出错(不影响原始数据): ' + toErrMsg_(monthlyErr));
      }
    } else {
      console.log('');
      console.log('⏳ 时间不足，月度广告费汇总将在下次运行 main() 时自动执行。');
    }

    if (isInitMode && (status === 'completed' || status === 'completed_with_errors')) {
      var mSheet = ss.getSheetByName(SHEET_MONTHLY_STATE);
      var monthlyDone = !mSheet || mSheet.getLastRow() < 2;
      if (monthlyDone) {
        console.log('');
        console.log('🎉 全量初始化完成（原始数据 + 月度广告费汇总）！请将 lookback_days 改为正整数，切换到日常模式。');
      } else {
        console.log('');
        console.log('⏳ 原始数据已完成，月度广告费汇总尚未完毕，请再次运行 main() 继续。');
      }
    }

    console.log('========== 脚本结束 ==========');

  } catch (fatalErr) {
    console.log('');
    console.log('💀 致命错误: ' + toErrMsg_(fatalErr));
    console.log('💀 堆栈: ' + (fatalErr && fatalErr.stack ? fatalErr.stack : 'N/A'));
    try {
      var ssFb = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
      ensureSheets_(ssFb);
      ssFb.getSheetByName(SHEET_LOG).appendRow([
        'fatal_' + new Date().getTime(), new Date(RUNTIME.startMs), new Date(),
        'UNKNOWN', '', '', '', 0, 0, 0, 0, 0,
        0, 0, 0, 'fatal_error', getElapsed_(), toErrMsg_(fatalErr)
      ]);
      var cfgFb = loadConfig_(ssFb);
      if (cfgFb.alertEmail) {
        sendAlert_(cfgFb.alertEmail, 'FATAL', 'fatal_error', 0, [toErrMsg_(fatalErr)]);
      }
    } catch (logErr) {
      console.log('💀 写日志也失败: ' + toErrMsg_(logErr));
    }
    throw fatalErr;
  }
}

/**
 * 采集各子账号广告消耗（按自然月拆分），写入月汇总明细与汇总 Sheet。
 * 通过 config 表的 lookback_days 自动切换运行模式：
 *   lookback_days = 0 → 初始化模式：从 2025-01-01 到今天，按月拆分全量采集
 *   lookback_days > 0 → 日常模式：仅统计回溯窗口内的实际消耗，按涉及月份拆分写入
 * 逐月采集+写入，支持按月份断点续跑。
 */
function runMonthlyCostSummary() {
  var calledFromMain = (RUNTIME.startMs > 0);
  if (!calledFromMain) {
    RUNTIME.startMs = new Date().getTime();
    RUNTIME.forcedStop = false;
    RUNTIME.mccId = String(AdsApp.currentAccount().getCustomerId());
  }

  try {
    if (!SPREADSHEET_URL || SPREADSHEET_URL.indexOf('REPLACE_ME') >= 0) {
      throw new Error('请先替换 SPREADSHEET_URL');
    }

    var ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
    ensureSheets_(ss);

    var cfg = loadConfig_(ss);
    var tz = cfg.timezone || AdsApp.currentAccount().getTimeZone();
    var isInitMode = (cfg.lookbackDays === 0);
    var mode = isManagerScript_() ? 'MCC' : 'SINGLE';
    var accountIds = listAccountIds_(cfg.accountWhitelist, mode);

    var today = formatDate_(new Date(), tz);
    var startDate;
    if (isInitMode) {
      startDate = COST_INIT_START_DATE;
    } else {
      var currentMonthFirst = today.substring(0, 8) + '01';
      startDate = currentMonthFirst;
    }

    var monthWindows = generateMonthlyWindows_(startDate, today);
    var monthlyState = getOrInitMonthlyState_(
      ss, isInitMode, tz, mode, accountIds, startDate, today, monthWindows
    );

    console.log('===== 广告费汇总开始 (' + (isInitMode ? '初始化模式' : '日常模式') + ') =====');
    console.log('日期范围: ' + monthlyState.startDate + ' ~ ' + monthlyState.endDate);
    console.log('月份窗口: ' + monthlyState.monthWindows.length + ' 个');
    console.log('月份进度: ' + monthlyState.monthCursor + '/' + monthlyState.monthWindows.length);
    console.log('子账号: ' + accountIds.length + ' 个');

    var totalDetailRows = 0;
    var totalMonthsWritten = 0;
    var monthlyRunFailed = false;
    var queryStageInterrupted = false;

    var accountCostCache = {};
    var queriedCount = 0;
    console.log('');
    console.log('  === 阶段1: 批量采集账户日花费 ===');
    for (var i = 0; i < accountIds.length; i++) {
      if (shouldStop_('monthly_query_acct_' + i)) {
        console.log('  ⛔ 时间不足，停止于账户查询 ' + (i + 1) + '/' + accountIds.length);
        queryStageInterrupted = true;
        break;
      }
      var accountId = accountIds[i];
      try {
        selectAccountById_(accountId, mode);
        accountCostCache[accountId] = collectAccountDailyCosts_(
          monthlyState.startDate, monthlyState.endDate
        );
        queriedCount++;
      } catch (err) {
        console.log('  ❌ [' + accountId + '] 查询失败: ' + toErrMsg_(err));
        monthlyRunFailed = true;
      }
    }

    if (monthlyRunFailed) {
      console.log('  ⚠️ 存在失败账户，停止本次运行');
    } else if (queryStageInterrupted) {
      console.log('  ⚠️ 查询阶段因时间不足中断，停止本次运行并保留旧月汇总');
    } else if (queriedCount === 0) {
      console.log('  ⚠️ 无账户数据可写入');
    } else {
      console.log('  ✓ 账户日花费查询完成: ' + queriedCount + '/' + accountIds.length);

      console.log('');
      console.log('  === 阶段2: 按月聚合并写入 ===');
      for (var m = monthlyState.monthCursor; m < monthlyState.monthWindows.length; m++) {
        if (shouldStop_('monthly_write_month_' + m)) {
          console.log('  ⛔ 时间不足，停止于月份 ' + monthlyState.monthWindows[m].month +
            ' (' + (m + 1) + '/' + monthlyState.monthWindows.length + ')');
          break;
        }

        var mw = monthlyState.monthWindows[m];
        var detailRows = [];
        var fetchedAt = formatDateTime_(new Date(), tz);

        console.log('');
        console.log('  [月份 ' + (m + 1) + '/' + monthWindows.length + '] ' +
          mw.month + ' (' + mw.startDate + ' ~ ' + mw.endDate + ')');

        for (var j = 0; j < accountIds.length; j++) {
          var cached = accountCostCache[accountIds[j]];
          if (!cached) { continue; }
          var monthCost = aggregateDailyCostsForMonth_(cached, mw);
          detailRows.push(buildMonthlyCostRow_(monthCost, mw, fetchedAt, RUNTIME.mccId));
        }

        var summaryRows = buildMonthlySummaryRows_(detailRows);
        replaceMonthlyRows_(ss, SHEET_MONTHLY_COST, MONTHLY_COST_HEADERS, mw.month, RUNTIME.mccId, detailRows);
        replaceMonthlyRows_(ss, SHEET_MONTHLY_SUMMARY, MONTHLY_SUMMARY_HEADERS, mw.month, RUNTIME.mccId, summaryRows);
        SpreadsheetApp.flush();
        monthlyState.monthCursor = m + 1;
        saveMonthlyStateToSheet_(ss, monthlyState);

        totalDetailRows += detailRows.length;
        totalMonthsWritten++;
        console.log('  ✓ 写入 ' + detailRows.length + ' 行明细 + ' + summaryRows.length + ' 行汇总');
      }
    }

    console.log('');
    console.log('===== 广告费汇总结束 =====');
    console.log('已写入月份: ' + monthlyState.monthCursor + '/' + monthlyState.monthWindows.length);
    console.log('总明细行: ' + totalDetailRows);
    console.log('耗时: ' + getElapsed_() + 's');

    if (monthlyState.monthCursor >= monthlyState.monthWindows.length) {
      clearMonthlyStateSheet_(ss);
      console.log('');
      if (isInitMode) {
        console.log('🎉 广告费全量初始化完成！请将 lookback_days 改为正整数切换到日常模式。');
      } else {
        console.log('✓ 广告费日常汇总完成。');
      }
    } else if (monthlyRunFailed) {
      console.log('');
      console.log('⏳ 本次停止在失败月份，请修复后重跑，脚本会从该月份继续。');
    } else if (monthlyState.monthCursor < monthlyState.monthWindows.length) {
      console.log('');
      console.log('⏳ 尚未完成全部月份，请再次运行继续。');
    }
  } catch (err) {
    console.log('💀 广告费汇总失败: ' + toErrMsg_(err));
    throw err;
  }
}

// =====================================================================
// 阶段 1：账户诊断
// =====================================================================

/**
 * 对每个账户执行轻量查询，统计 non-REMOVED campaign 数量，同时缓存账户名称。
 * @param {!Object} state 续跑状态。
 * @param {!Object<string, string>} nameCache 账户名称缓存（accountId → name），由此函数填充。
 * @return {!Array<{accountId:string, enabledCount:number}>}
 */
function diagnoseCampaignCounts_(state, nameCache) {
  var results = [];
  for (var i = 0; i < state.accountIds.length; i++) {
    if (shouldStop_('diagnose_' + i)) {
      for (var j = i; j < state.accountIds.length; j++) {
        results.push({ accountId: state.accountIds[j], enabledCount: -1 });
      }
      break;
    }

    var accountId = state.accountIds[i];
    var count = 0;
    try {
      selectAccountById_(accountId, state.mode);
      var acctName = String(AdsApp.currentAccount().getName() || '');
      nameCache[accountId] = acctName || accountId;
      var report = AdsApp.report(
        "SELECT campaign.id FROM campaign WHERE campaign.status != 'REMOVED'"
      );
      var rows = report.rows();
      while (rows.hasNext()) {
        rows.next();
        count++;
      }
    } catch (e) {
      count = -1;
      if (!nameCache[accountId]) { nameCache[accountId] = accountId; }
    }
    results.push({ accountId: accountId, enabledCount: count });

    if (count > 0) {
      console.log('  ' + accountId + ' (' + nameCache[accountId] + '): ' + count + ' campaigns (non-removed)');
    } else if (count === 0) {
      console.log('  ' + accountId + ' (' + nameCache[accountId] + '): 0 campaigns (non-removed)');
    }
  }
  return results;
}

// =====================================================================
// 阶段 2：数据采集
// =====================================================================

/**
 * 采集广告系列预算快照（独立于 ad_group_ad 明细，保证凌晨也能落表）。
 * @param {string} timezone 时区。
 * @param {string} accountId 账户 ID。
 * @param {string} accountName 账户名。
 * @return {!Array<!Array<*>>}
 */
function collectBudgetSnapshotRows_(timezone, accountId, accountName) {
  var now = new Date();
  var snapshotDate = formatDate_(now, timezone);
  var snapshotTime = formatDateTime_(now, timezone);
  var out = [];

  var query =
    'SELECT customer.currency_code, ' +
    'campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ' +
    'campaign_budget.amount_micros ' +
    'FROM campaign ' +
    "WHERE campaign.status != 'REMOVED'";

  var rows = AdsApp.report(query).rows();
  while (rows.hasNext()) {
    var r = rows.next();
    out.push([
      snapshotDate,
      accountId,
      accountName,
      RUNTIME.mccId,
      safeStr_(r['customer.currency_code']) || 'USD',
      safeStr_(r['campaign.id']),
      safeStr_(r['campaign.name']),
      safeStr_(r['campaign.status']),
      safeStr_(r['campaign.advertising_channel_type']),
      microsToCurrency_(r['campaign_budget.amount_micros']),
      snapshotTime,
      snapshotTime
    ]);
  }

  return out;
}

/**
 * 采集广告级日报数据（含广告系列级 SIS / Budget Lost IS / Rank Lost IS）。
 * 广告系列预算额外写入独立快照表；日报中的 budget 列仍保留兼容用途。
 * SIS 查询失败为非致命（enrichment），主查询失败直接抛错。
 * @param {string} startDate 开始日期。
 * @param {string} endDate 结束日期。
 * @param {string} timezone 时区。
 * @param {string} accountId 账户 ID。
 * @param {string} accountName 账户名。
 * @return {!Array<!Array<*>>}
 * @throws {Error} 主 ad_group_ad 查询失败时抛出。
 */
function collectReportRows_(startDate, endDate, timezone, accountId, accountName, budgetAmountMap) {
  var updatedAt = formatDateTime_(new Date(), timezone);

  var sisMap = {};
  try {
    var targetDates = generateDateList_(startDate, endDate);

    if (targetDates.length <= 7) {
      // 滚动7天窗口：对每个目标日期 D，取 (D-7)~(D-1) 共7天的汇总展示份额
      for (var di = 0; di < targetDates.length; di++) {
        var targetDate = targetDates[di];
        var sisWindowEnd = shiftDateStr_(targetDate, -1);
        var sisWindowStart = shiftDateStr_(targetDate, -7);

        var sisQuery =
          'SELECT campaign.id, ' +
          'metrics.search_impression_share, ' +
          'metrics.search_budget_lost_impression_share, ' +
          'metrics.search_rank_lost_impression_share ' +
          'FROM campaign ' +
          "WHERE campaign.status != 'REMOVED' " +
          "AND segments.date BETWEEN '" + sisWindowStart + "' AND '" + sisWindowEnd + "'";
        var sisRows = AdsApp.report(sisQuery).rows();
        while (sisRows.hasNext()) {
          var sr = sisRows.next();
          var campId = safeStr_(sr['campaign.id']);
          var key = campId + '_' + targetDate;
          sisMap[key] = {
            sis: safeSis_(sr['metrics.search_impression_share']),
            budgetLost: safeSis_(sr['metrics.search_budget_lost_impression_share']),
            rankLost: safeSis_(sr['metrics.search_rank_lost_impression_share'])
          };
        }
      }
    } else {
      // 日期范围超过31天（如初始化模式），退回逐日查询避免 API 请求过多
      console.log('    ℹ️ 日期范围超过7天，SIS退回逐日查询模式（非滚动7天窗口）');
      var sisQueryFallback =
        'SELECT segments.date, campaign.id, ' +
        'metrics.search_impression_share, ' +
        'metrics.search_budget_lost_impression_share, ' +
        'metrics.search_rank_lost_impression_share ' +
        'FROM campaign ' +
        "WHERE campaign.status != 'REMOVED' " +
        "AND segments.date BETWEEN '" + startDate + "' AND '" + endDate + "'";
      var sisFallbackRows = AdsApp.report(sisQueryFallback).rows();
      while (sisFallbackRows.hasNext()) {
        var sr = sisFallbackRows.next();
        var campId = safeStr_(sr['campaign.id']);
        var key = campId + '_' + safeStr_(sr['segments.date']);
        sisMap[key] = {
          sis: safeSis_(sr['metrics.search_impression_share']),
          budgetLost: safeSis_(sr['metrics.search_budget_lost_impression_share']),
          rankLost: safeSis_(sr['metrics.search_rank_lost_impression_share'])
        };
      }
    }
  } catch (e) {
    console.log('    ⚠️ SIS查询失败(非致命，SIS列将为空): ' + toErrMsg_(e));
  }

  if (!budgetAmountMap) { budgetAmountMap = {}; }

  // 地理定向（enrichment，失败非致命）
  var geoMap = {};
  try {
    var geoQuery =
      'SELECT campaign.id, campaign_criterion.location.geo_target_constant ' +
      'FROM campaign_criterion ' +
      "WHERE campaign.status != 'REMOVED' " +
      'AND campaign_criterion.type = LOCATION ' +
      'AND campaign_criterion.negative = false';
    var geoRows = AdsApp.report(geoQuery).rows();
    var geoRaw = {};
    while (geoRows.hasNext()) {
      var gr = geoRows.next();
      var geoCampId = safeStr_(gr['campaign.id']);
      var geoConstant = safeStr_(gr['campaign_criterion.location.geo_target_constant']);
      if (!geoRaw[geoCampId]) { geoRaw[geoCampId] = []; }
      if (geoConstant && geoRaw[geoCampId].indexOf(geoConstant) === -1) {
        geoRaw[geoCampId].push(geoConstant);
      }
    }
    for (var geoId in geoRaw) {
      geoMap[geoId] = geoRaw[geoId].join(', ');
    }
  } catch (e) {
    console.log('    ⚠️ 地理定向查询失败(非致命，target_country列将为空): ' + toErrMsg_(e));
  }

  var out = [];
  var query =
    'SELECT ' +
    'segments.date, customer.currency_code, ' +
    'campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ' +
    'ad_group.id, ad_group.name, ' +
    'ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status, ad_group_ad.ad.final_urls, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
    'metrics.conversions, metrics.conversions_value, ' +
    'metrics.ctr, metrics.average_cpc ' +
    'FROM ad_group_ad ' +
    "WHERE campaign.status != 'REMOVED' " +
    // 不按 ad_group / ad 当前状态过滤：回溯窗口重采时，6 月初已移除的广告
    // 仍应计入历史花费，否则与 Google Ads 后台（6.1–6.17 总费用）对不上。
    "AND segments.date BETWEEN '" + startDate + "' AND '" + endDate + "'";

  var rows = AdsApp.report(query).rows();
  while (rows.hasNext()) {
    var r = rows.next();
    var campId = safeStr_(r['campaign.id']);
    var dateStr = safeStr_(r['segments.date']);
    var sisKey = campId + '_' + dateStr;
    var sisData = sisMap[sisKey] || {};
    out.push([
      dateStr,
      accountId,
      accountName,
      RUNTIME.mccId,
      safeStr_(r['customer.currency_code']),
      campId,
      safeStr_(r['campaign.name']),
      safeStr_(r['campaign.status']),
      safeStr_(r['campaign.advertising_channel_type']),
      budgetAmountMap[campId] !== undefined ? budgetAmountMap[campId] : '',
      geoMap[campId] || '',
      safeStr_(r['ad_group.id']),
      safeStr_(r['ad_group.name']),
      safeStr_(r['ad_group_ad.ad.id']),
      safeStr_(r['ad_group_ad.ad.type']),
      safeStr_(r['ad_group_ad.status']),
      safeStr_(r['ad_group_ad.ad.final_urls']),
      safeNum_(r['metrics.impressions']),
      safeNum_(r['metrics.clicks']),
      microsToCurrency_(r['metrics.cost_micros']),
      safeNum_(r['metrics.cost_micros']),
      safeNum_(r['metrics.conversions']),
      safeNum_(r['metrics.conversions_value']),
      safeNum_(r['metrics.ctr']),
      microsToCurrency_(r['metrics.average_cpc']),
      sisData.sis !== undefined ? sisData.sis : '',
      sisData.budgetLost !== undefined ? sisData.budgetLost : '',
      sisData.rankLost !== undefined ? sisData.rankLost : '',
      updatedAt
    ]);
  }

  return out;
}

/**
 * 采集关键词级日报数据（含最高每次点击费用 max_cpc）。
 * 失败直接抛出，由调用方处理。
 * @param {string} startDate 开始日期。
 * @param {string} endDate 结束日期。
 * @param {string} timezone 时区。
 * @param {string} accountId 账户 ID。
 * @param {string} accountName 账户名。
 * @return {!Array<!Array<*>>}
 * @throws {Error} GAQL 查询失败时抛出。
 */
function collectKeywordRows_(startDate, endDate, timezone, accountId, accountName) {
  var updatedAt = formatDateTime_(new Date(), timezone);
  var out = [];

  var query =
    'SELECT ' +
    'segments.date, customer.currency_code, ' +
    'campaign.id, campaign.name, ' +
    'ad_group.id, ad_group.name, ' +
    'ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ' +
    'ad_group_criterion.keyword.match_type, ad_group_criterion.status, ' +
    'ad_group_criterion.cpc_bid_micros, ' +
    'ad_group_criterion.quality_info.quality_score, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
    'metrics.conversions, metrics.conversions_value, ' +
    'metrics.ctr, metrics.average_cpc ' +
    'FROM keyword_view ' +
    "WHERE campaign.status != 'REMOVED' " +
    "AND ad_group.status != 'REMOVED' " +
    "AND ad_group_criterion.status != 'REMOVED' " +
    "AND segments.date BETWEEN '" + startDate + "' AND '" + endDate + "'";

  var rows = AdsApp.report(query).rows();
  while (rows.hasNext()) {
    var r = rows.next();
    out.push([
      safeStr_(r['segments.date']),
      accountId,
      accountName,
      safeStr_(r['customer.currency_code']),
      safeStr_(r['campaign.id']),
      safeStr_(r['campaign.name']),
      safeStr_(r['ad_group.id']),
      safeStr_(r['ad_group.name']),
      safeStr_(r['ad_group_criterion.criterion_id']),
      safeStr_(r['ad_group_criterion.keyword.text']),
      safeStr_(r['ad_group_criterion.keyword.match_type']),
      safeStr_(r['ad_group_criterion.status']),
      microsToCurrency_(r['ad_group_criterion.cpc_bid_micros']),
      safeQualityScore_(r['ad_group_criterion.quality_info.quality_score']),
      safeNum_(r['metrics.impressions']),
      safeNum_(r['metrics.clicks']),
      microsToCurrency_(r['metrics.cost_micros']),
      safeNum_(r['metrics.conversions']),
      safeNum_(r['metrics.conversions_value']),
      safeNum_(r['metrics.ctr']),
      microsToCurrency_(r['metrics.average_cpc']),
      updatedAt
    ]);
  }

  return out;
}

/**
 * 采集搜索字词报告。
 * 日常模式：startDate=endDate=今天，仅采集今日数据。
 * 初始化模式当前也只采集今日，以避免全历史搜索词数据量过大。
 * @param {string} startDate 查询开始日期。
 * @param {string} endDate 查询结束日期。
 * @param {string} timezone 时区。
 * @param {string} accountId 账户 ID。
 * @param {string} accountName 账户名。
 * @param {number} minImpressions 最小展示次数过滤阈值。
 * @return {!Array<!Array<*>>}
 * @throws {Error} GAQL 查询失败时抛出。
 */
function collectSearchTermRows_(startDate, endDate, timezone, accountId, accountName, minImpressions) {
  var updatedAt = formatDateTime_(new Date(), timezone);
  var out = [];

  var query =
    'SELECT ' +
    'segments.date, customer.currency_code, ' +
    'campaign.id, campaign.name, ' +
    'ad_group.id, ad_group.name, ' +
    'segments.keyword.info.text, segments.keyword.info.match_type, ' +
    'search_term_view.search_term, search_term_view.status, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
    'metrics.conversions, metrics.conversions_value, ' +
    'metrics.ctr, metrics.average_cpc ' +
    'FROM search_term_view ' +
    "WHERE campaign.status != 'REMOVED' " +
    "AND segments.date BETWEEN '" + startDate + "' AND '" + endDate + "'" +
    (minImpressions > 1 ? ' AND metrics.impressions >= ' + minImpressions : '');

  var rows = AdsApp.report(query).rows();
  while (rows.hasNext()) {
    var r = rows.next();
    out.push([
      safeStr_(r['segments.date']),
      accountId,
      accountName,
      safeStr_(r['customer.currency_code']),
      safeStr_(r['campaign.id']),
      safeStr_(r['campaign.name']),
      safeStr_(r['ad_group.id']),
      safeStr_(r['ad_group.name']),
      safeStr_(r['segments.keyword.info.text']),
      safeStr_(r['segments.keyword.info.match_type']),
      safeStr_(r['search_term_view.search_term']),
      safeStr_(r['search_term_view.status']),
      safeNum_(r['metrics.impressions']),
      safeNum_(r['metrics.clicks']),
      microsToCurrency_(r['metrics.cost_micros']),
      safeNum_(r['metrics.conversions']),
      safeNum_(r['metrics.conversions_value']),
      safeNum_(r['metrics.ctr']),
      microsToCurrency_(r['metrics.average_cpc']),
      updatedAt
    ]);
  }

  return out;
}

/**
 * 采集当前已选账户在指定月窗口的总广告消耗。
 * 注意口径：查询 FROM customer，包含所有 campaign（含 REMOVED）的花费，
 * 与 raw_daily_report（仅 non-REMOVED campaign/ad_group/ad）的花费 SUM 存在差异，
 * 差异来源为已移除实体在移除前产生的花费。此差异属预期行为，monthly_account_cost
 * 反映账户级真实花费（用于财务对账），raw_daily_report 反映运营级花费（用于投放分析）。
 * @param {{month:string, startDate:string, endDate:string}} monthWindow 月份窗口。
 * @return {{customerId:string, customerName:string, currency:string, costMicros:number}}
 */
function collectMonthlyAccountCost_(monthWindow) {
  var query =
    'SELECT customer.id, customer.descriptive_name, customer.currency_code, metrics.cost_micros ' +
    'FROM customer ' +
    "WHERE segments.date BETWEEN '" + monthWindow.startDate + "' AND '" + monthWindow.endDate + "'";

  var rows = AdsApp.report(query).rows();
  var totalCostMicros = 0;
  var customerId = '';
  var customerName = '';
  var currency = '';
  while (rows.hasNext()) {
    var row = rows.next();
    if (!customerId) {
      customerId = safeStr_(row['customer.id']);
      customerName = safeStr_(row['customer.descriptive_name']);
      currency = safeStr_(row['customer.currency_code']);
    }
    totalCostMicros += safeNum_(row['metrics.cost_micros']);
  }

  if (customerId) {
    return {
      customerId: customerId,
      customerName: customerName,
      currency: currency,
      costMicros: totalCostMicros
    };
  }

  var account = AdsApp.currentAccount();
  return {
    customerId: safeStr_(account.getCustomerId()),
    customerName: safeStr_(account.getName()),
    currency: account.getCurrencyCode ? safeStr_(account.getCurrencyCode()) : '',
    costMicros: 0
  };
}

/**
 * 一次性采集当前已选账户在指定日期范围内的每日花费。
 * 每个账户仅查询一次，由调用方按月聚合，大幅减少 API 调用和 selectAccountById_ 次数。
 * @param {string} startDate 起始日期。
 * @param {string} endDate 结束日期。
 * @return {{baseInfo:{customerId:string,customerName:string,currency:string},dailyCosts:!Array<{date:string,costMicros:number}>}}
 */
function collectAccountDailyCosts_(startDate, endDate) {
  var account = AdsApp.currentAccount();
  var baseInfo = {
    customerId: safeStr_(account.getCustomerId()),
    customerName: safeStr_(account.getName()),
    currency: account.getCurrencyCode ? safeStr_(account.getCurrencyCode()) : ''
  };

  var query =
    'SELECT segments.date, customer.id, customer.descriptive_name, ' +
    'customer.currency_code, metrics.cost_micros ' +
    'FROM customer ' +
    "WHERE segments.date BETWEEN '" + startDate + "' AND '" + endDate + "'";

  var rows = AdsApp.report(query).rows();
  var dailyCosts = [];
  while (rows.hasNext()) {
    var r = rows.next();
    if (!baseInfo.currency) {
      baseInfo.customerId = safeStr_(r['customer.id']);
      baseInfo.customerName = safeStr_(r['customer.descriptive_name']);
      baseInfo.currency = safeStr_(r['customer.currency_code']);
    }
    dailyCosts.push({
      date: safeStr_(r['segments.date']),
      costMicros: safeNum_(r['metrics.cost_micros'])
    });
  }

  return { baseInfo: baseInfo, dailyCosts: dailyCosts };
}

/**
 * 从日花费缓存中聚合指定月份窗口的花费。
 * @param {{baseInfo:{customerId:string,customerName:string,currency:string},dailyCosts:!Array<{date:string,costMicros:number}>}} cached 缓存数据。
 * @param {{month:string,startDate:string,endDate:string}} monthWindow 月份窗口。
 * @return {{customerId:string,customerName:string,currency:string,costMicros:number}}
 */
function aggregateDailyCostsForMonth_(cached, monthWindow) {
  var totalCostMicros = 0;
  for (var i = 0; i < cached.dailyCosts.length; i++) {
    var dc = cached.dailyCosts[i];
    if (dc.date >= monthWindow.startDate && dc.date <= monthWindow.endDate) {
      totalCostMicros += dc.costMicros;
    }
  }
  return {
    customerId: cached.baseInfo.customerId,
    customerName: cached.baseInfo.customerName,
    currency: cached.baseInfo.currency,
    costMicros: totalCostMicros
  };
}

// =====================================================================
// 写入：安全覆写（日常模式专用）
// =====================================================================

/**
 * 安全覆写：合并旧数据与新数据后覆写到 Sheet（不使用 clear，防崩溃数据全丢）。
 * @param {!SpreadsheetApp.Spreadsheet} ss 表格对象。
 * @param {string} sheetName 表名。
 * @param {!Array<string>} headers 表头。
 * @param {string} startDate 窗口开始日期。
 * @param {string} endDate 窗口结束日期。
 * @param {string} retentionCutoff 保留截止日期（空=不限）。
 * @param {!Array<!Array<*>>} newRows 新数据。
 * @param {!Array<string>} processedAccountIds 已处理的账户 ID。
 * @return {number} 写入的新行数。
 */
function bulkWriteWindowData_(ss, sheetName, headers, startDate, endDate, retentionCutoff, newRows, processedAccountIds) {
  var sheet = ss.getSheetByName(sheetName);
  var lastRow = sheet.getLastRow();
  var kept = [];

  var processedSet = {};
  for (var p = 0; p < processedAccountIds.length; p++) {
    processedSet[normalizeCustomerId_(processedAccountIds[p])] = true;
  }
  var dedupedNewRows = dedupeRowsForSheet_(sheetName, newRows);

  if (lastRow > 1) {
    var oldColCount = sheet.getLastColumn();
    if (oldColCount !== headers.length) {
      throw new Error('写入表列数不匹配: ' + sheetName +
        ' expected=' + headers.length + ' actual=' + oldColCount);
    } else {
      var oldData = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
      var removed = 0;
      var expired = 0;
      for (var i = 0; i < oldData.length; i++) {
        var rowDate = toDateStr_(oldData[i][COL_DATE]);
        if (!rowDate) { removed++; continue; }
        var rowCid = normalizeCustomerId_(oldData[i][COL_CUSTOMER_ID]);
        if (retentionCutoff && rowDate < retentionCutoff) {
          expired++;
        } else if (rowDate >= startDate && rowDate <= endDate && processedSet[rowCid]) {
          removed++;
        } else {
          kept.push(oldData[i]);
        }
      }
      console.log('  窗口清理(' + sheetName + '): 移除' + removed +
        '行 过期' + expired + '行 保留' + kept.length + '行');
    }
  }

  var finalRows = dedupeRowsForSheet_(sheetName, kept.concat(dedupedNewRows));

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  if (finalRows.length > 0) {
    var batchSize = Math.max(500, WRITE_BATCH_SIZE);
    for (var b = 0; b < finalRows.length; b += batchSize) {
      var chunk = finalRows.slice(b, b + batchSize);
      sheet.getRange(2 + b, 1, chunk.length, headers.length).setValues(chunk);
    }
  }

  var dataEndRow = 1 + finalRows.length;
  var sheetLastRow = sheet.getLastRow();
  if (sheetLastRow > dataEndRow) {
    sheet.deleteRows(dataEndRow + 1, sheetLastRow - dataEndRow);
  }

  return dedupedNewRows.length;
}

/**
 * 用快照表和已有报告数据回填历史日期预算，避免回溯窗口重写时丢失历史真实预算。
 * 优先从 campaign_budget_snapshots 查找（日级精确），不足时回退到 raw_daily_report 已有值。
 * @param {!SpreadsheetApp.Spreadsheet} ss 表格对象。
 * @param {!Array<!Array<*>>} newRows 待写入广告报告行。
 * @param {!Array<string>} processedAccountIds 本次已处理账户。
 * @param {string} startDate 当前窗口开始日期。
 * @param {string} endDate 当前窗口结束日期。
 * @param {string} timezone 时区。
 * @return {number} 回填成功的行数。
 */
function backfillHistoricalCampaignBudgets_(ss, newRows, processedAccountIds, startDate, endDate, timezone) {
  if (!newRows || newRows.length === 0 || !processedAccountIds || processedAccountIds.length === 0) {
    return 0;
  }

  var todayDate = formatDate_(new Date(), timezone);
  var historicalEndDate = endDate < todayDate ? endDate : shiftDateStr_(todayDate, -1);
  if (startDate > historicalEndDate) {
    return 0;
  }

  var processedSet = {};
  for (var i = 0; i < processedAccountIds.length; i++) {
    processedSet[normalizeCustomerId_(processedAccountIds[i])] = true;
  }

  var historyBudgetMap = {};
  var snapshotFilledKeys = 0;

  var snapSheet = ss.getSheetByName(SHEET_BUDGET_SNAPSHOTS);
  if (snapSheet && snapSheet.getLastRow() > 1) {
    var snapRows = snapSheet.getRange(2, 1, snapSheet.getLastRow() - 1, BUDGET_SNAPSHOT_HEADERS.length).getValues();
    for (var s = 0; s < snapRows.length; s++) {
      var snapDate = toDateStr_(snapRows[s][0]);
      if (!snapDate || snapDate < startDate || snapDate > historicalEndDate) {
        continue;
      }
      var snapCid = normalizeCustomerId_(snapRows[s][1]);
      if (!processedSet[snapCid]) {
        continue;
      }
      var snapCampId = safeStr_(snapRows[s][COL_BUDGET_SNAPSHOT_CAMPAIGN_ID]).trim();
      if (!snapCampId) {
        continue;
      }
      var snapBudget = snapRows[s][9];
      if (snapBudget === '' || snapBudget === null || snapBudget === undefined) {
        continue;
      }
      var snapKey = snapDate + '|' + snapCid + '|' + snapCampId;
      historyBudgetMap[snapKey] = snapBudget;
      snapshotFilledKeys++;
    }
  }

  var reportSheet = ss.getSheetByName(SHEET_REPORT);
  if (reportSheet && reportSheet.getLastRow() > 1) {
    var existingRows = reportSheet.getRange(2, 1, reportSheet.getLastRow() - 1, REPORT_HEADERS.length).getValues();
    for (var r = 0; r < existingRows.length; r++) {
      var oldDate = toDateStr_(existingRows[r][COL_DATE]);
      if (!oldDate || oldDate < startDate || oldDate > historicalEndDate) {
        continue;
      }
      var oldCustomerId = normalizeCustomerId_(existingRows[r][COL_CUSTOMER_ID]);
      if (!processedSet[oldCustomerId]) {
        continue;
      }
      var oldCampaignId = safeStr_(existingRows[r][COL_REPORT_CAMPAIGN_ID]).trim();
      if (!oldCampaignId) {
        continue;
      }
      var oldBudget = existingRows[r][COL_REPORT_CAMPAIGN_BUDGET];
      if (oldBudget === '' || oldBudget === null || oldBudget === undefined) {
        continue;
      }
      var oldKey = oldDate + '|' + oldCustomerId + '|' + oldCampaignId;
      if (!Object.prototype.hasOwnProperty.call(historyBudgetMap, oldKey)) {
        historyBudgetMap[oldKey] = oldBudget;
      }
    }
  }

  var filledCount = 0;
  for (var n = 0; n < newRows.length; n++) {
    var rowDate = safeStr_(newRows[n][COL_DATE]);
    if (!rowDate || rowDate < startDate || rowDate > historicalEndDate) {
      continue;
    }

    var rowCustomerId = normalizeCustomerId_(newRows[n][COL_CUSTOMER_ID]);
    var rowCampaignId = safeStr_(newRows[n][COL_REPORT_CAMPAIGN_ID]).trim();
    if (!rowCustomerId || !rowCampaignId) {
      continue;
    }

    var key = rowDate + '|' + rowCustomerId + '|' + rowCampaignId;
    if (Object.prototype.hasOwnProperty.call(historyBudgetMap, key)) {
      newRows[n][COL_REPORT_CAMPAIGN_BUDGET] = historyBudgetMap[key];
      filledCount++;
    }
  }

  console.log('  历史预算回填: ' + filledCount + ' 行 (快照源keys=' + snapshotFilledKeys + ')');
  return filledCount;
}

/**
 * 统计本次预算快照行的覆盖情况。
 * @param {!Array<!Array<*>>} rows 预算快照行。
 * @return {{accountCount:number, campaignCount:number}}
 */
function summarizeBudgetSnapshotRows_(rows) {
  var accountSet = {};
  var campaignSet = {};

  for (var i = 0; i < rows.length; i++) {
    var rowDate = safeStr_(rows[i][COL_DATE]);
    var budgetValue = rows[i][COL_REPORT_CAMPAIGN_BUDGET];
    if (budgetValue === '' || budgetValue === null || budgetValue === undefined) {
      continue;
    }

    var customerId = safeStr_(rows[i][COL_CUSTOMER_ID]).trim();
    var campaignId = safeStr_(rows[i][COL_BUDGET_SNAPSHOT_CAMPAIGN_ID]).trim();
    if (!customerId || !campaignId) {
      continue;
    }

    accountSet[customerId] = true;
    campaignSet[customerId + '|' + campaignId] = true;
  }

  return {
    accountCount: Object.keys(accountSet).length,
    campaignCount: Object.keys(campaignSet).length
  };
}

/**
 * 对比今日新快照与快照表中最近一天的旧快照，检测并记录预算变更。
 * @param {!SpreadsheetApp.Spreadsheet} ss 表格对象。
 * @param {!Array<!Array<*>>} newSnapshotRows 今日新快照行。
 * @param {string} timezone 时区。
 */
function detectBudgetChanges_(ss, newSnapshotRows, timezone) {
  if (!newSnapshotRows || newSnapshotRows.length === 0) { return; }

  var todayDate = formatDate_(new Date(), timezone);
  var yesterdayDate = shiftDateStr_(todayDate, -1);

  var snapSheet = ss.getSheetByName(SHEET_BUDGET_SNAPSHOTS);
  if (!snapSheet || snapSheet.getLastRow() <= 1) { return; }

  var oldData = snapSheet.getRange(2, 1, snapSheet.getLastRow() - 1, BUDGET_SNAPSHOT_HEADERS.length).getValues();
  var oldBudgetMap = {};
  for (var o = 0; o < oldData.length; o++) {
    var oldDate = toDateStr_(oldData[o][0]);
    if (oldDate !== yesterdayDate && oldDate !== todayDate) { continue; }
    var oldCid = normalizeCustomerId_(oldData[o][1]);
    var oldCampId = safeStr_(oldData[o][COL_BUDGET_SNAPSHOT_CAMPAIGN_ID]).trim();
    if (!oldCid || !oldCampId) { continue; }
    var oldKey = oldCid + '|' + oldCampId;
    if (!oldBudgetMap[oldKey] || oldDate > toDateStr_(oldBudgetMap[oldKey].date)) {
      oldBudgetMap[oldKey] = { date: oldDate, budget: oldData[o][9], name: safeStr_(oldData[o][6]) };
    }
  }

  var changes = [];
  for (var n = 0; n < newSnapshotRows.length; n++) {
    var newCid = normalizeCustomerId_(newSnapshotRows[n][1]);
    var newCampId = safeStr_(newSnapshotRows[n][COL_BUDGET_SNAPSHOT_CAMPAIGN_ID]).trim();
    var newBudget = newSnapshotRows[n][9];
    var newCampName = safeStr_(newSnapshotRows[n][6]);
    if (!newCid || !newCampId) { continue; }

    var key = newCid + '|' + newCampId;
    var old = oldBudgetMap[key];
    if (!old) { continue; }

    var oldVal = safeNum_(old.budget);
    var newVal = safeNum_(newBudget);
    if (oldVal !== newVal) {
      changes.push({
        cid: newCid,
        campId: newCampId,
        campName: newCampName,
        oldBudget: oldVal,
        newBudget: newVal,
        delta: newVal - oldVal
      });
    }
  }

  if (changes.length > 0) {
    console.log('  📊 预算变更检测: ' + changes.length + ' 个广告系列预算发生变化');
    for (var c = 0; c < changes.length && c < 20; c++) {
      console.log('    ' + changes[c].campName +
        ' (' + changes[c].campId + '): $' + changes[c].oldBudget +
        ' → $' + changes[c].newBudget +
        ' (' + (changes[c].delta > 0 ? '+' : '') + changes[c].delta + ')');
    }
    if (changes.length > 20) {
      console.log('    ... 还有 ' + (changes.length - 20) + ' 个变更未显示');
    }
  }
}

/**
 * 搜索字词专用写入：新周期清空旧数据，续跑时追加（日常模式专用）。
 * @param {!SpreadsheetApp.Spreadsheet} ss 表格对象。
 * @param {!Array<!Array<*>>} newRows 新数据。
 * @param {boolean} isNewCycle 是否为新周期（首次运行，非续跑）。
 * @return {number} 写入行数。
 */
function writeSearchTermData_(ss, newRows, isNewCycle) {
  var sheet = ss.getSheetByName(SHEET_SEARCH_TERMS);

  if (isNewCycle) {
    sheet.clear();
    sheet.getRange(1, 1, 1, SEARCH_TERM_HEADERS.length).setValues([SEARCH_TERM_HEADERS]);
    forceTextColumns_(sheet, SEARCH_TERM_HEADERS);
  }

  if (newRows.length > 0) {
    var startRow = sheet.getLastRow() + 1;
    var batchSize = Math.max(500, WRITE_BATCH_SIZE);
    for (var b = 0; b < newRows.length; b += batchSize) {
      var chunk = newRows.slice(b, b + batchSize);
      sheet.getRange(startRow + b, 1, chunk.length, SEARCH_TERM_HEADERS.length).setValues(chunk);
    }
  }

  return newRows.length;
}

// =====================================================================
// 写入：追加模式（初始化模式专用）
// =====================================================================

/**
 * 向指定 Sheet 追加数据行（初始化模式逐账户追加，不做覆写合并）。
 * @param {!SpreadsheetApp.Spreadsheet} ss 表格对象。
 * @param {string} sheetName 表名。
 * @param {!Array<string>} headers 表头。
 * @param {!Array<!Array<*>>} rows 数据行。
 */
function appendRowsToSheet_(ss, sheetName, headers, rows) {
  if (rows.length === 0) { return; }
  rows = dedupeRowsForSheet_(sheetName, rows);
  var sheet = ss.getSheetByName(sheetName);
  var startRow = sheet.getLastRow() + 1;
  var batchSize = Math.max(500, WRITE_BATCH_SIZE);
  for (var b = 0; b < rows.length; b += batchSize) {
    var chunk = rows.slice(b, b + batchSize);
    sheet.getRange(startRow + b, 1, chunk.length, headers.length).setValues(chunk);
  }
}

/**
 * 清理初始化模式上次中断时某个账户可能残留的半成品数据。
 * @param {!SpreadsheetApp.Spreadsheet} ss 表格对象。
 * @param {!Object} state 续跑状态。
 * @param {boolean} useKw 是否启用关键词报告。
 * @param {boolean} useSt 是否启用搜索字词报告。
 * @return {number} 总移除行数。
 */
function cleanupPendingInitRows_(ss, state, useKw, useSt) {
  var pendingAccountId = safeStr_(state.pendingAccountId);
  if (!pendingAccountId) { return 0; }
  var startDate = safeStr_(state.pendingStartDate || state.startDate);
  var endDate = safeStr_(state.pendingEndDate || state.endDate);
  var cfgSnapshot = state.cfgSnapshot || {};
  var stLookbackDays = parseInt(String(cfgSnapshot.searchTermLookbackDays || 7), 10);
  if (isNaN(stLookbackDays) || stLookbackDays < 1) { stLookbackDays = 7; }
  var stStartDate = stLookbackDays > 1 ? shiftDateStr_(endDate, -(stLookbackDays - 1)) : endDate;
  var removed = 0;

  removed += removeAccountWindowRows_(
    ss, SHEET_REPORT, REPORT_HEADERS, pendingAccountId, startDate, endDate
  );
  if (useKw) {
    removed += removeAccountWindowRows_(
      ss, SHEET_KEYWORDS, KEYWORD_HEADERS, pendingAccountId, startDate, endDate
    );
  }
  if (useSt) {
    removed += removeAccountWindowRows_(
      ss, SHEET_SEARCH_TERMS, SEARCH_TERM_HEADERS, pendingAccountId, stStartDate, endDate
    );
  }
  removed += removeAccountWindowRows_(
    ss, SHEET_BUDGET_SNAPSHOTS, BUDGET_SNAPSHOT_HEADERS, pendingAccountId, endDate, endDate
  );
  console.log('  半成品清理完成: CID=' + pendingAccountId + ' removed=' + removed);
  return removed;
}

/**
 * 删除指定账户在指定日期窗口内的旧数据行。
 * @param {!SpreadsheetApp.Spreadsheet} ss 表格对象。
 * @param {string} sheetName 表名。
 * @param {!Array<string>} headers 表头。
 * @param {string} accountId 账户 ID。
 * @param {string} startDate 起始日期。
 * @param {string} endDate 结束日期。
 * @return {number} 删除行数。
 */
function removeAccountWindowRows_(ss, sheetName, headers, accountId, startDate, endDate) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) { return 0; }
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) { return 0; }
  if (sheet.getLastColumn() !== headers.length) {
    throw new Error('初始化清理时列数不匹配: ' + sheetName +
      ' expected=' + headers.length + ' actual=' + sheet.getLastColumn());
  }

  var oldRows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var kept = [];
  var removed = 0;
  var normalizedAccountId = normalizeCustomerId_(accountId);
  for (var i = 0; i < oldRows.length; i++) {
    var rowDate = toDateStr_(oldRows[i][COL_DATE]);
    var rowCid = normalizeCustomerId_(oldRows[i][COL_CUSTOMER_ID]);
    if (rowCid === normalizedAccountId && rowDate >= startDate && rowDate <= endDate) {
      removed++;
      continue;
    }
    kept.push(oldRows[i]);
  }

  if (removed === 0) { return 0; }

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (kept.length > 0) {
    sheet.getRange(2, 1, kept.length, headers.length).setValues(kept);
  }
  var expectedLastRow = 1 + kept.length;
  var actualLastRow = sheet.getLastRow();
  if (actualLastRow > expectedLastRow) {
    sheet.deleteRows(expectedLastRow + 1, actualLastRow - expectedLastRow);
  }
  return removed;
}

/**
 * 初始化模式在新周期开始时清空原始明细表，保证真正的全量重建。
 * 月汇总表由各自的 replace 逻辑安全覆写，无需在这里清空。
 * @param {!SpreadsheetApp.Spreadsheet} ss 表格对象。
 */
function resetInitRawDataSheets_(ss) {
  rewriteSheetWithHeaders_(ss.getSheetByName(SHEET_REPORT), REPORT_HEADERS);
  rewriteSheetWithHeaders_(ss.getSheetByName(SHEET_KEYWORDS), KEYWORD_HEADERS);
  rewriteSheetWithHeaders_(ss.getSheetByName(SHEET_SEARCH_TERMS), SEARCH_TERM_HEADERS);
  rewriteSheetWithHeaders_(ss.getSheetByName(SHEET_BUDGET_SNAPSHOTS), BUDGET_SNAPSHOT_HEADERS);
  console.log('  初始化模式新周期：已清空原始数据表，准备全量重建');
}

/**
 * 清空指定 Sheet 并重写表头。
 * @param {!SpreadsheetApp.Sheet} sheet 表对象。
 * @param {!Array<string>} headers 表头。
 */
function rewriteSheetWithHeaders_(sheet, headers) {
  if (!sheet) {
    throw new Error('初始化重建失败：目标 Sheet 不存在');
  }
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  forceTextColumns_(sheet, headers);
}

/**
 * 对行数据按业务主键做幂等去重，保留 updated_at 较新的那一行。
 * 仅对存在稳定业务主键的明细表生效，其他表原样返回。
 * @param {string} sheetName 表名。
 * @param {!Array<!Array<*>>} rows 原始行数据。
 * @return {!Array<!Array<*>>}
 */
function dedupeRowsForSheet_(sheetName, rows) {
  if (!rows || rows.length === 0) { return []; }
  if (sheetName !== SHEET_REPORT && sheetName !== SHEET_KEYWORDS && sheetName !== SHEET_BUDGET_SNAPSHOTS) {
    return rows.slice();
  }

  var keptByKey = {};
  var orderedKeys = [];
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var key = buildBusinessRowKey_(sheetName, row);
    if (!key) {
      key = '__row__' + i;
    }
    if (!Object.prototype.hasOwnProperty.call(keptByKey, key)) {
      orderedKeys.push(key);
      keptByKey[key] = row;
      continue;
    }
    if (shouldReplaceDedupeRow_(keptByKey[key], row)) {
      keptByKey[key] = row;
    }
  }

  var out = [];
  for (var j = 0; j < orderedKeys.length; j++) {
    out.push(keptByKey[orderedKeys[j]]);
  }
  return out;
}

/**
 * 构造明细表业务主键。
 * @param {string} sheetName 表名。
 * @param {!Array<*>} row 数据行。
 * @return {string}
 */
function buildBusinessRowKey_(sheetName, row) {
  var dateStr = toDateStr_(row[COL_DATE]);
  var customerId = normalizeCustomerId_(row[COL_CUSTOMER_ID]);
  if (!dateStr || !customerId) { return ''; }

  if (sheetName === SHEET_REPORT) {
    return [
      dateStr,
      customerId,
      safeStr_(row[COL_REPORT_CAMPAIGN_ID]).trim(),
      safeStr_(row[11]).trim(),
      safeStr_(row[13]).trim()
    ].join('|');
  }

  if (sheetName === SHEET_KEYWORDS) {
    return [
      dateStr,
      customerId,
      safeStr_(row[4]).trim(),
      safeStr_(row[6]).trim(),
      safeStr_(row[8]).trim()
    ].join('|');
  }

  if (sheetName === SHEET_BUDGET_SNAPSHOTS) {
    return [
      dateStr,
      customerId,
      safeStr_(row[COL_BUDGET_SNAPSHOT_CAMPAIGN_ID]).trim()
    ].join('|');
  }

  return '';
}

/**
 * 比较去重冲突时保留哪一行。
 * 优先保留 updated_at 更新的行；无法比较时保留后出现的行。
 * @param {!Array<*>} current 当前保留行。
 * @param {!Array<*>} incoming 候选替换行。
 * @return {boolean}
 */
function shouldReplaceDedupeRow_(current, incoming) {
  var currentUpdatedAt = safeStr_(current[current.length - 1]).trim();
  var incomingUpdatedAt = safeStr_(incoming[incoming.length - 1]).trim();
  if (!currentUpdatedAt && incomingUpdatedAt) { return true; }
  if (currentUpdatedAt && !incomingUpdatedAt) { return false; }
  if (incomingUpdatedAt > currentUpdatedAt) { return true; }
  if (incomingUpdatedAt < currentUpdatedAt) { return false; }
  return true;
}

/**
 * 按 month + mcc_id 覆写月汇总数据，便于重复执行时安全重跑。
 * @param {!SpreadsheetApp.Spreadsheet} ss 表格对象。
 * @param {string} sheetName 表名。
 * @param {!Array<string>} headers 表头。
 * @param {string} month 月份标识，格式 yyyy-MM。
 * @param {string} mccId MCC 账号 ID。
 * @param {!Array<!Array<*>>} newRows 新数据。
 */
function replaceMonthlyRows_(ss, sheetName, headers, month, mccId, newRows) {
  var sheet = ss.getSheetByName(sheetName);
  var kept = [];
  var lastRow = sheet.getLastRow();

  if (lastRow > 1 && sheet.getLastColumn() !== headers.length) {
    throw new Error('月汇总表列数不匹配: ' + sheetName +
      ' expected=' + headers.length + ' actual=' + sheet.getLastColumn());
  }

  if (lastRow > 1) {
    var oldRows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    for (var i = 0; i < oldRows.length; i++) {
      var oldMonth = normalizeMonthStr_(oldRows[i][0]);
      var oldMccId = '';
      if (sheetName === SHEET_MONTHLY_COST) {
        oldMccId = safeStr_(oldRows[i][5]);
      } else if (sheetName === SHEET_MONTHLY_SUMMARY) {
        oldMccId = safeStr_(oldRows[i][3]);
      }
      if (oldMonth === month && oldMccId === mccId) {
        continue;
      }
      normalizeMonthlyRow_(oldRows[i]);
      kept.push(oldRows[i]);
    }
  }

  var finalRows = kept.concat(newRows);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (finalRows.length > 0) {
    sheet.getRange(2, 1, finalRows.length, headers.length).setValues(finalRows);
  }

  var expectedLastRow = 1 + finalRows.length;
  var actualLastRow = sheet.getLastRow();
  if (actualLastRow > expectedLastRow) {
    sheet.deleteRows(expectedLastRow + 1, actualLastRow - expectedLastRow);
  }
}

// =====================================================================
// 时间控制
// =====================================================================

/**
 * 检查是否应停止。
 * @param {string} phase 阶段名。
 * @return {boolean}
 */
function shouldStop_(phase) {
  if (RUNTIME.forcedStop) { return true; }
  var elapsed = (new Date().getTime() - RUNTIME.startMs) / 1000;
  if (elapsed >= MAX_RUNTIME_SECONDS - MIN_RESERVE_SECONDS) {
    RUNTIME.forcedStop = true;
    console.log('⛔ 时间限制: ' + Math.floor(elapsed) + 's, phase=' + phase);
    return true;
  }
  return false;
}

/** @return {number} 已运行秒数。 */
function getElapsed_() {
  return Math.floor((new Date().getTime() - RUNTIME.startMs) / 1000);
}

// =====================================================================
// 续跑状态（Sheet 存储）
// =====================================================================

/**
 * 获取或初始化续跑状态。
 * cursor = 上次所有写入完成后的位置（安全恢复点）。
 * collectCursor = 采集进度（仅信息展示用，不作为恢复点）。
 * cfgSnapshot = 初始化时快照的采集配置，续跑时保证同一周期一致。
 * @param {!SpreadsheetApp.Spreadsheet} ss 表格。
 * @param {!Object} cfg 配置。
 * @param {boolean} isInitMode 是否为初始化模式。
 * @return {!Object}
 */
function getOrInitState_(ss, cfg, isInitMode) {
  var tz = cfg.timezone || AdsApp.currentAccount().getTimeZone();
  var win = getWindow_(cfg.lookbackDays, tz);
  var mode = isManagerScript_() ? 'MCC' : 'SINGLE';
  var ids = listAccountIds_(cfg.accountWhitelist, mode);
  var retCutoff = '';
  if (!isInitMode && cfg.maxRetentionDays > 0) {
    var cutDate = new Date();
    cutDate.setDate(cutDate.getDate() - cfg.maxRetentionDays);
    retCutoff = formatDate_(cutDate, tz);
  }

  var sheet = ss.getSheetByName(SHEET_STATE);
  if (sheet && sheet.getLastRow() >= 2) {
    try {
      var json = sheet.getRange(2, 1).getValue();
      if (json) {
        var old = JSON.parse(String(json));
        if (old && old.active && old.accountIds && old.accountIds.length > 0 &&
            old.cursor < old.accountIds.length &&
            isResumeStateCompatible_(old, isInitMode, mode, tz, win, ids, retCutoff)) {
          if (old.collectCursor === undefined) { old.collectCursor = old.cursor; }
          if (!old.cfgSnapshot) {
            old.cfgSnapshot = {
              enableKeywordReport: cfg.enableKeywordReport,
              enableSearchTermReport: cfg.enableSearchTermReport,
              searchTermMinImpressions: cfg.searchTermMinImpressions,
              searchTermLookbackDays: cfg.searchTermLookbackDays
            };
          }
          console.log('  恢复续跑: cursor=' + old.cursor +
            ' collectCursor=' + old.collectCursor +
            '/' + old.accountIds.length);
          return old;
        }
        console.log('  续跑状态与当前配置不一致，重新初始化');
      }
    } catch (e) {
      console.log('  续跑状态损坏，重新初始化');
    }
  }

  console.log('  时区: ' + tz);
  console.log('  窗口: ' + win.startDate + ' ~ ' + win.endDate +
    (isInitMode ? ' (全量历史)' : ''));
  console.log('  模式: ' + mode);
  console.log('  账户(' + ids.length + '): ' +
    ids.slice(0, 8).join(', ') + (ids.length > 8 ? '...' : ''));

  var state = {
    active: true,
    cycleType: isInitMode ? 'init' : 'daily',
    runId: (isInitMode ? 'init_' : 'run_') +
      new Date().getTime() + '_' + Math.random().toString(36).substring(2, 8),
    mode: mode,
    timezone: tz,
    startDate: win.startDate,
    endDate: win.endDate,
    retentionCutoff: retCutoff,
    accountIds: ids,
    cursor: 0,
    collectCursor: 0,
    pendingAccountId: '',
    pendingStartDate: '',
    pendingEndDate: '',
    cfgSnapshot: {
      enableKeywordReport: cfg.enableKeywordReport,
      enableSearchTermReport: cfg.enableSearchTermReport,
      searchTermMinImpressions: cfg.searchTermMinImpressions,
      searchTermLookbackDays: cfg.searchTermLookbackDays
    }
  };
  saveStateToSheet_(ss, state);
  return state;
}

/** @param {!SpreadsheetApp.Spreadsheet} ss @param {!Object} state */
function saveStateToSheet_(ss, state) {
  var sheet = ss.getSheetByName(SHEET_STATE);
  if (!sheet) { sheet = ss.insertSheet(SHEET_STATE); }
  sheet.clear();
  sheet.getRange(1, 1).setValue('state_json');
  sheet.getRange(2, 1).setValue(JSON.stringify(state));
}

/** @param {!SpreadsheetApp.Spreadsheet} ss */
function clearStateSheet_(ss) {
  var sheet = ss.getSheetByName(SHEET_STATE);
  if (sheet) {
    sheet.clear();
    sheet.getRange(1, 1).setValue('state_json');
  }
}

/**
 * 获取或初始化广告费月汇总的续跑状态。
 * @param {!SpreadsheetApp.Spreadsheet} ss 表格。
 * @param {boolean} isInitMode 是否为初始化模式。
 * @param {string} tz 时区。
 * @param {string} mode 运行模式。
 * @param {!Array<string>} accountIds 账户列表。
 * @param {string} startDate 查询开始日期。
 * @param {string} endDate 查询结束日期。
 * @param {!Array<{month:string,startDate:string,endDate:string}>} monthWindows 月份窗口。
 * @return {!Object}
 */
function getOrInitMonthlyState_(ss, isInitMode, tz, mode, accountIds, startDate, endDate, monthWindows) {
  var sheet = ss.getSheetByName(SHEET_MONTHLY_STATE);
  if (sheet && sheet.getLastRow() >= 2) {
    try {
      var json = sheet.getRange(2, 1).getValue();
      if (json) {
        var old = JSON.parse(String(json));
        if (old && old.active &&
            old.monthWindows && old.monthWindows.length > 0 &&
            old.monthCursor < old.monthWindows.length &&
            isMonthlyStateCompatible_(old, isInitMode, tz, mode, accountIds, startDate, endDate, monthWindows)) {
          if (isInitMode &&
              (safeStr_(old.endDate) !== endDate ||
               !sameMonthlyWindows_(old.monthWindows || [], monthWindows))) {
            old.endDate = endDate;
            old.monthWindows = cloneMonthlyWindows_(monthWindows);
            if (old.monthCursor > old.monthWindows.length) {
              old.monthCursor = old.monthWindows.length;
            }
            saveMonthlyStateToSheet_(ss, old);
          }
          console.log('  恢复月汇总续跑: monthCursor=' + old.monthCursor +
            '/' + old.monthWindows.length);
          return old;
        }
      }
      console.log('  月汇总续跑状态与当前配置不一致，重新初始化');
    } catch (e) {
      console.log('  月汇总续跑状态损坏，重新初始化');
    }
  }

  var state = {
    active: true,
    runId: 'monthly_' + new Date().getTime() + '_' + Math.random().toString(36).substring(2, 8),
    mode: mode,
    timezone: tz,
    isInitMode: isInitMode,
    startDate: startDate,
    endDate: endDate,
    accountIds: accountIds.slice(),
    monthWindows: cloneMonthlyWindows_(monthWindows),
    monthCursor: 0
  };
  saveMonthlyStateToSheet_(ss, state);
  return state;
}

/**
 * @param {!SpreadsheetApp.Spreadsheet} ss
 * @param {!Object} state
 */
function saveMonthlyStateToSheet_(ss, state) {
  var sheet = ss.getSheetByName(SHEET_MONTHLY_STATE);
  if (!sheet) { sheet = ss.insertSheet(SHEET_MONTHLY_STATE); }
  sheet.clear();
  sheet.getRange(1, 1).setValue('state_json');
  sheet.getRange(2, 1).setValue(JSON.stringify(state));
}

/** @param {!SpreadsheetApp.Spreadsheet} ss */
function clearMonthlyStateSheet_(ss) {
  var sheet = ss.getSheetByName(SHEET_MONTHLY_STATE);
  if (sheet) {
    sheet.clear();
    sheet.getRange(1, 1).setValue('state_json');
  }
}

// =====================================================================
// 账户操作
// =====================================================================

/** @return {!Array<string>} */
function listAccountIds_(whitelist, mode) {
  if (mode === 'SINGLE') {
    return [String(AdsApp.currentAccount().getCustomerId())];
  }
  var sel = AdsManagerApp.accounts();
  if (whitelist && whitelist.length > 0) {
    sel = sel.withIds(whitelist);
  }
  var out = [];
  var it = sel.get();
  while (it.hasNext()) { out.push(String(it.next().getCustomerId())); }
  return out;
}

/** @param {string} accountId @param {string} mode */
function selectAccountById_(accountId, mode) {
  if (mode === 'SINGLE') { return; }
  var it = AdsManagerApp.accounts().withIds([accountId]).get();
  if (!it.hasNext()) { throw new Error('账户不可访问: ' + accountId); }
  AdsManagerApp.select(it.next());
}

// =====================================================================
// 配置
// =====================================================================

/** @return {!Object} */
function loadConfig_(ss) {
  var sheet = ss.getSheetByName(SHEET_CONFIG);
  var vals = sheet.getDataRange().getValues();

  var allDefs = [
    ['lookback_days', '7', '回补天数（截止昨天；0=初始化模式；日常建议7）'],
    ['max_runtime_seconds', String(MAX_RUNTIME_SECONDS), '最大运行秒数'],
    ['min_reserve_seconds', String(MIN_RESERVE_SECONDS), '收尾预留秒数'],
    ['write_batch_size', String(WRITE_BATCH_SIZE), '批量写入行数'],
    ['max_retention_days', '30', '数据保留天数，超期自动清理（0=不限；初始化模式建议0）'],
    ['timezone', '', '为空使用账户时区，如 Asia/Shanghai'],
    ['alert_email', '', '告警邮箱，留空不发'],
    ['account_id_whitelist', '', 'CID 逗号分隔'],
    ['enable_keyword_report', 'true', '是否采集关键词报告（true/false）'],
    ['enable_search_term_report', 'true', '是否采集搜索字词报告（true/false）'],
    ['search_term_min_impressions', '1', '搜索字词最小展示次数过滤（0=不过滤）'],
    ['search_term_lookback_days', '7', '搜索字词回溯天数（1=仅当天，7=最近7天）'],
    ['_schema_version', String(DATA_SCHEMA_VER), '数据表schema版本（勿改）']
  ];

  if (vals.length <= 1) {
    sheet.getRange(2, 1, allDefs.length, 3).setValues(allDefs);
    vals = sheet.getDataRange().getValues();
  } else {
    var existingKeys = {};
    for (var i = 1; i < vals.length; i++) {
      var ek = safeStr_(vals[i][0]).trim();
      if (ek) { existingKeys[ek] = true; }
    }
    var missing = [];
    for (var d = 0; d < allDefs.length; d++) {
      if (!existingKeys[allDefs[d][0]]) { missing.push(allDefs[d]); }
    }
    if (missing.length > 0) {
      var nextRow = sheet.getLastRow() + 1;
      sheet.getRange(nextRow, 1, missing.length, 3).setValues(missing);
      console.log('  config补写缺失项: ' + missing.map(function(r){return r[0];}).join(', '));
      vals = sheet.getDataRange().getValues();
    }
  }

  var m = {};
  for (var i = 1; i < vals.length; i++) {
    var k = safeStr_(vals[i][0]).trim();
    var v = safeStr_(vals[i][1]).trim();
    if (k) { m[k] = v; }
  }

  MAX_RUNTIME_SECONDS = posInt_(m.max_runtime_seconds, MAX_RUNTIME_SECONDS);
  MIN_RESERVE_SECONDS = posInt_(m.min_reserve_seconds, MIN_RESERVE_SECONDS);
  WRITE_BATCH_SIZE = posInt_(m.write_batch_size, WRITE_BATCH_SIZE);

  var rawTz = m.timezone || '';
  if (rawTz && !/^[A-Za-z_]+\/[A-Za-z_]+/.test(rawTz)) {
    console.log('  ⚠️ timezone值无效("' + rawTz + '")，已忽略');
    rawTz = '';
  }
  var rawEmail = m.alert_email || '';
  if (rawEmail && rawEmail.indexOf('@') === -1) {
    console.log('  ⚠️ alert_email值无效("' + rawEmail + '")，已忽略');
    rawEmail = '';
  }

  var retDays = parseInt(String(m.max_retention_days || '30'), 10);
  if (isNaN(retDays) || retDays < 0) { retDays = 30; }

  var enableKw = (m.enable_keyword_report || 'true').toLowerCase() === 'true';
  var enableSt = (m.enable_search_term_report || 'true').toLowerCase() === 'true';
  var stMinImpr = parseInt(String(m.search_term_min_impressions || '1'), 10);
  if (isNaN(stMinImpr) || stMinImpr < 0) { stMinImpr = 1; }
  var stLookbackDays = parseInt(String(m.search_term_lookback_days || '7'), 10);
  if (isNaN(stLookbackDays) || stLookbackDays < 1) { stLookbackDays = 7; }

  var lookback = parseInt(String(m.lookback_days || String(DEFAULT_LOOKBACK_DAYS)), 10);
  if (isNaN(lookback) || lookback < 0) { lookback = DEFAULT_LOOKBACK_DAYS; }

  return {
    lookbackDays: lookback,
    maxRetentionDays: retDays,
    timezone: rawTz,
    alertEmail: rawEmail,
    accountWhitelist: parseAccountIds_(m.account_id_whitelist || ''),
    enableKeywordReport: enableKw,
    enableSearchTermReport: enableSt,
    searchTermMinImpressions: stMinImpr,
    searchTermLookbackDays: stLookbackDays
  };
}

// =====================================================================
// Sheet 初始化
// =====================================================================

function ensureSheets_(ss) {
  ensureSheet_(ss, SHEET_CONFIG, ['key', 'value', 'desc'], false);

  var forceClear = false;
  var cfgSheet = ss.getSheetByName(SHEET_CONFIG);
  var storedVer = 0;
  if (cfgSheet && cfgSheet.getLastRow() > 1) {
    var cfgData = cfgSheet.getDataRange().getValues();
    for (var i = 1; i < cfgData.length; i++) {
      if (String(cfgData[i][0]).trim() === '_schema_version') {
        storedVer = parseInt(String(cfgData[i][1]), 10) || 0;
        break;
      }
    }
  }
  if (storedVer < DATA_SCHEMA_VER) {
    console.log('  ⚠️ 数据schema升级: v' + storedVer + ' → v' + DATA_SCHEMA_VER + '，将清空数据表');
    forceClear = true;
  }

  ensureSheet_(ss, SHEET_REPORT, REPORT_HEADERS, forceClear);
  ensureSheet_(ss, SHEET_KEYWORDS, KEYWORD_HEADERS, forceClear);
  ensureSheet_(ss, SHEET_SEARCH_TERMS, SEARCH_TERM_HEADERS, forceClear);
  ensureSheet_(ss, SHEET_BUDGET_SNAPSHOTS, BUDGET_SNAPSHOT_HEADERS, false);
  ensureSheet_(ss, SHEET_MONTHLY_COST, MONTHLY_COST_HEADERS, false);
  ensureSheet_(ss, SHEET_MONTHLY_SUMMARY, MONTHLY_SUMMARY_HEADERS, false);
  ensureSheet_(ss, SHEET_LOG, LOG_HEADERS, false);
  if (forceClear) {
    clearStateSheet_(ss);
    clearMonthlyStateSheet_(ss);
  }

  if (forceClear && cfgSheet) {
    var found = false;
    if (cfgSheet.getLastRow() > 1) {
      var vals = cfgSheet.getDataRange().getValues();
      for (var j = 1; j < vals.length; j++) {
        if (String(vals[j][0]).trim() === '_schema_version') {
          cfgSheet.getRange(j + 1, 2).setValue(DATA_SCHEMA_VER);
          found = true;
          break;
        }
      }
    }
    if (!found) {
      cfgSheet.getRange(cfgSheet.getLastRow() + 1, 1, 1, 3)
        .setValues([['_schema_version', DATA_SCHEMA_VER, '数据表schema版本（勿改）']]);
    }
    console.log('  schema版本已更新为 v' + DATA_SCHEMA_VER);
  }

  var obsolete = ['raw_daily_campaign', 'raw_daily_ad'];
  for (var k = 0; k < obsolete.length; k++) {
    var old = ss.getSheetByName(obsolete[k]);
    if (old) {
      ss.deleteSheet(old);
      console.log('  已删除废弃Sheet: ' + obsolete[k]);
    }
  }
}

/**
 * @param {!SpreadsheetApp.Spreadsheet} ss
 * @param {string} name
 * @param {!Array<string>} headers
 * @param {boolean} forceClear
 */
function ensureSheet_(ss, name, headers, forceClear) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    console.log('  新建Sheet: ' + name);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    forceTextColumns_(sheet, headers);
    return;
  }

  if (forceClear) {
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    forceTextColumns_(sheet, headers);
    console.log('  schema升级清空: ' + name);
    return;
  }

  var lastCol = sheet.getLastColumn();
  var readCols = Math.max(lastCol, headers.length);
  var existingHeaders = sheet.getRange(1, 1, 1, readCols).getValues()[0];
  var needRefresh = false;
  if (lastCol !== headers.length) {
    needRefresh = true;
  } else {
    for (var h = 0; h < headers.length; h++) {
      if (String(existingHeaders[h]).trim() !== headers[h]) {
        needRefresh = true;
        break;
      }
    }
  }
  if (needRefresh) {
    console.log('  schema变更: ' + name + ' 旧' + lastCol + '列→新' + headers.length + '列，清空旧数据');
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    forceTextColumns_(sheet, headers);
    console.log('  表头刷新: ' + name);
  }
}

// =====================================================================
// 日志写入
// =====================================================================

/**
 * @param {!SpreadsheetApp.Spreadsheet} ss
 * @param {!Object} state
 * @param {number} withCampaigns
 * @param {number} withData
 * @param {number} skipped
 * @param {number} failed
 * @param {number} adRowsWritten
 * @param {number} kwRowsWritten
 * @param {number} stRowsWritten
 * @param {string} status
 * @param {string} details
 */
function writeLog_(ss, state, withCampaigns, withData, skipped, failed,
                   adRowsWritten, kwRowsWritten, stRowsWritten, status, details) {
  ss.getSheetByName(SHEET_LOG).appendRow([
    state.runId, new Date(RUNTIME.startMs), new Date(),
    state.mode, state.timezone, state.startDate, state.endDate,
    state.accountIds.length, withCampaigns, withData, skipped, failed,
    adRowsWritten, kwRowsWritten, stRowsWritten,
    status, getElapsed_(), details
  ]);
}

/**
 * 发送告警邮件。
 * @param {string} email 收件人。
 * @param {string} runId 运行 ID。
 * @param {string} status 运行状态。
 * @param {number} failedCount 失败账户数。
 * @param {!Array<string>} details 失败详情。
 */
function sendAlert_(email, runId, status, failedCount, details) {
  try {
    var isInit = (runId.indexOf('init_') === 0);
    MailApp.sendEmail(email,
      '[Google Ads Script' + (isInit ? ' Init' : '') + '] ' + status,
      'Run ID: ' + runId +
      '\nStatus: ' + status +
      '\nFailed accounts: ' + failedCount +
      '\n\nDetails:\n' + details.join('\n'));
  } catch (e) {
    console.log('⚠️ 邮件发送失败: ' + toErrMsg_(e));
  }
}

// =====================================================================
// 工具函数
// =====================================================================

/**
 * 将含日期的列格式设为纯文本，防止 Sheets 自动转 Date 对象。
 * @param {!SpreadsheetApp.Sheet} sheet
 * @param {!Array<string>} headers
 */
function forceTextColumns_(sheet, headers) {
  var textCols = [
    'date', 'updated_at', 'started_at', 'ended_at',
    'month', 'start_date', 'end_date', 'fetched_at'
  ];
  var maxR = sheet.getMaxRows();
  for (var c = 0; c < headers.length; c++) {
    if (textCols.indexOf(headers[c]) !== -1) {
      sheet.getRange(1, c + 1, maxR, 1).setNumberFormat('@');
    }
  }
}

/**
 * 将 source 数组的所有元素逐个 push 到 target（避免 concat 的 O(n²) 拷贝）。
 * @param {!Array} target 目标数组。
 * @param {!Array} source 源数组。
 */
function pushAll_(target, source) {
  for (var i = 0; i < source.length; i++) {
    target.push(source[i]);
  }
}

/** @param {*} v 微单位原始值。@return {number} 实际货币值（保留2位小数）。 */
function microsToCurrency_(v) {
  var n = safeNum_(v);
  return Math.round(n / 10000) / 100;
}

function isManagerScript_() {
  try { return typeof AdsManagerApp !== 'undefined' && !!AdsManagerApp.accounts; }
  catch (e) { return false; }
}

/**
 * 计算查询时间窗口。
 * @param {number} days 回补天数，0 表示全部历史（从 ALL_TIME_START_DATE 到今天）。
 * @param {string} tz 时区。
 * @return {{startDate: string, endDate: string}}
 */
function getWindow_(days, tz) {
  var now = new Date();
  var endDate = formatDate_(addDays_(now, -1), tz);

  if (days === 0) {
    return { startDate: ALL_TIME_START_DATE, endDate: formatDate_(now, tz) };
  }

  return {
    startDate: formatDate_(addDays_(now, -days), tz),
    endDate: endDate
  };
}

function safeStr_(v) { return (v === null || v === undefined) ? '' : String(v); }

/**
 * 将 Date 对象或日期字符串转为 yyyy-MM-dd 格式。
 * @param {*} v 值。
 * @return {string}
 */
function toDateStr_(v) {
  if (v instanceof Date) {
    var y = v.getFullYear();
    var m = v.getMonth() + 1;
    var d = v.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }
  var s = safeStr_(v);
  var match = s.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (match) {
    var matchMonth = parseInt(match[2], 10);
    var matchDay = parseInt(match[3], 10);
    return match[1] + '-' +
      (matchMonth < 10 ? '0' : '') + matchMonth + '-' +
      (matchDay < 10 ? '0' : '') + matchDay;
  }
  var parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    var py = parsed.getFullYear();
    var pm = parsed.getMonth() + 1;
    var pd = parsed.getDate();
    return py + '-' + (pm < 10 ? '0' : '') + pm + '-' + (pd < 10 ? '0' : '') + pd;
  }
  return s;
}

function safeNum_(v) {
  if (v === null || v === undefined || v === '' || v === '--') { return 0; }
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

/**
 * search_impression_share 系列指标专用：非搜索广告返回 '--'，保留为空字符串而非 0。
 * @param {*} v 原始值。
 * @return {number|string}
 */
function safeSis_(v) {
  if (v === null || v === undefined || v === '' || v === '--' || v === ' --') {
    return '';
  }
  var n = Number(v);
  return isNaN(n) ? '' : n;
}

/**
 * 质量分专用：返回 1-10 的整数，数据不足时返回空字符串（API 返回 0 或 null 表示无数据）。
 * @param {*} v 原始值。
 * @return {number|string}
 */
function safeQualityScore_(v) {
  if (v === null || v === undefined || v === '' || v === '--' || v === ' --') {
    return '';
  }
  var n = parseInt(v, 10);
  if (isNaN(n) || n <= 0) { return ''; }
  return n;
}

function posInt_(raw, fb) {
  var n = parseInt(String(raw || ''), 10);
  return (isNaN(n) || n <= 0) ? fb : n;
}

function parseAccountIds_(raw) {
  if (!raw) { return []; }
  var parts = raw.split(',');
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var id = safeStr_(parts[i]).trim();
    if (!id) { continue; }
    var clean = id.replace(/[\s\-]/g, '');
    if (!/^\d{10}$/.test(clean)) { continue; }
    out.push(clean.substring(0, 3) + '-' + clean.substring(3, 6) + '-' + clean.substring(6));
  }
  return out;
}

function addDays_(d, delta) {
  var r = new Date(d.getTime());
  r.setDate(r.getDate() + delta);
  return r;
}

function formatDate_(d, tz) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); }
function formatDateTime_(d, tz) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd HH:mm:ss'); }

/**
 * 统一账号 ID 格式，兼容带横杠/不带横杠两种形式。
 * @param {*} v 原始值。
 * @return {string}
 */
function normalizeCustomerId_(v) {
  var raw = safeStr_(v).trim();
  if (!raw) { return ''; }
  var digits = raw.replace(/\D/g, '');
  if (digits.length === 10) {
    return digits.substring(0, 3) + '-' + digits.substring(3, 6) + '-' + digits.substring(6);
  }
  return raw;
}

/**
 * 根据起止日期生成按自然月拆分的窗口列表。
 * 首尾月份按真实起止日期裁剪，中间完整月份保持自然月边界。
 * @param {string} startDateStr 起始日期 yyyy-MM-dd。
 * @param {string} endDateStr 结束日期 yyyy-MM-dd。
 * @return {!Array<{month:string, startDate:string, endDate:string}>}
 */
function generateMonthlyWindows_(startDateStr, endDateStr) {
  var sp = startDateStr.split('-');
  var ep = endDateStr.split('-');
  var year = parseInt(sp[0], 10);
  var month = parseInt(sp[1], 10);
  var endYear = parseInt(ep[0], 10);
  var endMonth = parseInt(ep[1], 10);

  var windows = [];
  while (year < endYear || (year === endYear && month <= endMonth)) {
    var mm = (month < 10 ? '0' : '') + month;
    var label = year + '-' + mm;
    var firstDay = label + '-01';
    var lastDayNum = new Date(year, month, 0).getDate();
    var lastDay = label + '-' + (lastDayNum < 10 ? '0' : '') + lastDayNum;
    var windowStart = (firstDay < startDateStr) ? startDateStr : firstDay;
    var windowEnd = (lastDay > endDateStr) ? endDateStr : lastDay;

    windows.push({ month: label, startDate: windowStart, endDate: windowEnd });

    month++;
    if (month > 12) { month = 1; year++; }
  }
  return windows;
}

/**
 * 构造月广告费明细行。
 * @param {{customerId:string, customerName:string, currency:string, costMicros:number}} accountCost 账户月花费。
 * @param {{month:string, startDate:string, endDate:string}} monthWindow 月份窗口。
 * @param {string} fetchedAt 抓取时间。
 * @param {string} mccId MCC 账号 ID。
 * @return {!Array<*>}
 */
function buildMonthlyCostRow_(accountCost, monthWindow, fetchedAt, mccId) {
  return [
    monthWindow.month,
    monthWindow.startDate,
    monthWindow.endDate,
    accountCost.customerId,
    accountCost.customerName,
    mccId,
    accountCost.currency,
    microsToCurrency_(accountCost.costMicros),
    fetchedAt
  ];
}

/**
 * 根据月广告费明细生成按币种拆分的汇总行，避免不同币种被直接相加。
 * @param {!Array<!Array<*>>} detailRows 月广告费明细行。
 * @return {!Array<!Array<*>>}
 */
function buildMonthlySummaryRows_(detailRows) {
  var summaryMap = {};
  for (var i = 0; i < detailRows.length; i++) {
    var row = detailRows[i];
    var currency = safeStr_(row[6]);
    var key = safeStr_(row[0]) + '|' + safeStr_(row[5]) + '|' + currency;
    if (!summaryMap[key]) {
      summaryMap[key] = {
        month: safeStr_(row[0]),
        startDate: safeStr_(row[1]),
        endDate: safeStr_(row[2]),
        mccId: safeStr_(row[5]),
        currency: currency,
        accountsTotal: 0,
        accountsWithCost: 0,
        totalCost: 0,
        fetchedAt: safeStr_(row[8])
      };
    }

    summaryMap[key].accountsTotal++;
    if (safeNum_(row[7]) > 0) {
      summaryMap[key].accountsWithCost++;
    }
    summaryMap[key].totalCost = Math.round((summaryMap[key].totalCost + safeNum_(row[7])) * 100) / 100;
  }

  var out = [];
  var keys = Object.keys(summaryMap).sort();
  for (var j = 0; j < keys.length; j++) {
    var item = summaryMap[keys[j]];
    out.push([
      item.month,
      item.startDate,
      item.endDate,
      item.mccId,
      item.currency,
      item.accountsTotal,
      item.accountsWithCost,
      item.totalCost,
      item.fetchedAt
    ]);
  }
  return out;
}

/**
 * 判断主采集续跑状态是否仍与当前配置兼容。
 * @param {!Object} state 旧状态。
 * @param {boolean} isInitMode 是否初始化模式。
 * @param {string} mode 当前模式。
 * @param {string} tz 当前时区。
 * @param {{startDate:string,endDate:string}} win 当前窗口。
 * @param {!Array<string>} accountIds 当前账户列表。
 * @param {string} retentionCutoff 当前保留截止日期。
 * @return {boolean}
 */
function isResumeStateCompatible_(state, isInitMode, mode, tz, win, accountIds, retentionCutoff) {
  if (safeStr_(state.mode) !== mode || safeStr_(state.timezone) !== tz) { return false; }
  if (!sameStringArray_(state.accountIds || [], accountIds)) { return false; }
  var cycleType = safeStr_(state.cycleType || (state.startDate === ALL_TIME_START_DATE ? 'init' : 'daily'));
  if (cycleType !== (isInitMode ? 'init' : 'daily')) { return false; }
  if (cycleType === 'daily') {
    return safeStr_(state.startDate) === win.startDate &&
      safeStr_(state.endDate) === win.endDate &&
      safeStr_(state.retentionCutoff) === retentionCutoff;
  }
  return safeStr_(state.startDate) === ALL_TIME_START_DATE;
}

/**
 * 判断月汇总续跑状态是否仍与当前配置兼容。
 * @param {!Object} state 旧状态。
 * @param {boolean} isInitMode 是否初始化模式。
 * @param {string} tz 当前时区。
 * @param {string} mode 当前模式。
 * @param {!Array<string>} accountIds 当前账户列表。
 * @param {string} startDate 当前起始日期。
 * @param {string} endDate 当前结束日期。
 * @param {!Array<{month:string,startDate:string,endDate:string}>} monthWindows 当前窗口列表。
 * @return {boolean}
 */
function isMonthlyStateCompatible_(state, isInitMode, tz, mode, accountIds, startDate, endDate, monthWindows) {
  if (safeStr_(state.mode) !== mode || safeStr_(state.timezone) !== tz) { return false; }
  if (!!state.isInitMode !== isInitMode) { return false; }
  if (!sameStringArray_(state.accountIds || [], accountIds)) { return false; }
  if (isInitMode) {
    return safeStr_(state.startDate) === COST_INIT_START_DATE;
  }
  return safeStr_(state.startDate) === startDate &&
    safeStr_(state.endDate) === endDate &&
    sameMonthlyWindows_(state.monthWindows || [], monthWindows);
}

/**
 * 比较字符串数组是否完全一致。
 * @param {!Array<string>} left 左侧数组。
 * @param {!Array<string>} right 右侧数组。
 * @return {boolean}
 */
function sameStringArray_(left, right) {
  if (left.length !== right.length) { return false; }
  for (var i = 0; i < left.length; i++) {
    if (safeStr_(left[i]) !== safeStr_(right[i])) { return false; }
  }
  return true;
}

/**
 * 比较月份窗口列表是否完全一致。
 * @param {!Array<{month:string,startDate:string,endDate:string}>} left 左侧窗口。
 * @param {!Array<{month:string,startDate:string,endDate:string}>} right 右侧窗口。
 * @return {boolean}
 */
function sameMonthlyWindows_(left, right) {
  if (left.length !== right.length) { return false; }
  for (var i = 0; i < left.length; i++) {
    if (safeStr_(left[i].month) !== safeStr_(right[i].month) ||
        safeStr_(left[i].startDate) !== safeStr_(right[i].startDate) ||
        safeStr_(left[i].endDate) !== safeStr_(right[i].endDate)) {
      return false;
    }
  }
  return true;
}

/**
 * 复制月份窗口数组，避免状态对象意外共享引用。
 * @param {!Array<{month:string,startDate:string,endDate:string}>} monthWindows 月份窗口。
 * @return {!Array<{month:string,startDate:string,endDate:string}>}
 */
function cloneMonthlyWindows_(monthWindows) {
  var out = [];
  for (var i = 0; i < monthWindows.length; i++) {
    out.push({
      month: safeStr_(monthWindows[i].month),
      startDate: safeStr_(monthWindows[i].startDate),
      endDate: safeStr_(monthWindows[i].endDate)
    });
  }
  return out;
}

/**
 * 将 yyyy-MM-dd 日期字符串偏移指定天数。
 * @param {string} dateStr yyyy-MM-dd 格式日期。
 * @param {number} days 偏移天数（负数为往前，正数为往后）。
 * @return {string} yyyy-MM-dd 格式日期。
 */
function shiftDateStr_(dateStr, days) {
  var parts = dateStr.split('-');
  var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  d.setDate(d.getDate() + days);
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  var day = d.getDate();
  return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
}

/**
 * 生成从 startDate 到 endDate（含）的所有日期列表。
 * @param {string} startDate yyyy-MM-dd 格式起始日期。
 * @param {string} endDate yyyy-MM-dd 格式结束日期。
 * @return {!Array<string>} yyyy-MM-dd 格式日期数组。
 */
function generateDateList_(startDate, endDate) {
  var dates = [];
  var parts = startDate.split('-');
  var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  var eParts = endDate.split('-');
  var end = new Date(parseInt(eParts[0], 10), parseInt(eParts[1], 10) - 1, parseInt(eParts[2], 10));
  while (d <= end) {
    var y = d.getFullYear();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    dates.push(y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/**
 * 将 month 列的值归一化为 yyyy-MM 字符串，兼容 Date 对象和字符串。
 * Google Sheets 可能将 '2025-01' 自动转为 Date，读回后需要还原。
 * @param {*} v 原始值（可能是 String 或 Date）。
 * @return {string} yyyy-MM 格式字符串，无法解析时返回原始字符串。
 */
function normalizeMonthStr_(v) {
  if (v instanceof Date) {
    var y = v.getFullYear();
    var m = v.getMonth() + 1;
    return y + '-' + (m < 10 ? '0' : '') + m;
  }
  var s = safeStr_(v).trim();
  var match = s.match(/^(\d{4})-(\d{2})/);
  return match ? match[1] + '-' + match[2] : s;
}

/**
 * 原地归一化月汇总行的日期类列，将 Date 对象还原为格式化字符串。
 * 防止 kept 行写回时因 Date 对象导致格式异常。
 * @param {!Array<*>} row 月汇总行（会被直接修改）。
 */
function normalizeMonthlyRow_(row) {
  if (row[0] instanceof Date) { row[0] = normalizeMonthStr_(row[0]); }
  if (row[1] instanceof Date) { row[1] = toDateStr_(row[1]); }
  if (row[2] instanceof Date) { row[2] = toDateStr_(row[2]); }
}

function toErrMsg_(e) {
  if (!e) { return 'Unknown'; }
  return e.message ? String(e.message) : String(e);
}

/**
 * 手动清除续跑状态（在脚本编辑器里单独运行此函数）。
 */
function resetResumeState() {
  var ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  clearStateSheet_(ss);
  clearMonthlyStateSheet_(ss);
  console.log('✅ 主采集与月汇总续跑状态已清除');
}

/**
 * 一次性修复工具：用 campaign_budget_snapshots 表回填 raw_daily_report 中所有空预算行。
 * 在脚本编辑器里手动运行此函数。运行前无需停止日常采集。
 * 修复逻辑：
 *   1. 从快照表构建 (date, campaign_id) → budget 映射
 *   2. 扫描报告表，对 campaign_budget 为空的行尝试回填
 *   3. 快照表没有对应日期时，使用该 campaign 最近一次已知预算（前向填充）
 */
function repairHistoricalBudgets() {
  var ss = SpreadsheetApp.openByUrl(SPREADSHEET_URL);
  var cfg = loadConfig_(ss);
  var tz = cfg.timezone || 'America/New_York';

  var snapSheet = ss.getSheetByName(SHEET_BUDGET_SNAPSHOTS);
  if (!snapSheet || snapSheet.getLastRow() <= 1) {
    console.log('⚠️ campaign_budget_snapshots 表无数据，无法修复');
    return;
  }

  console.log('===== 历史预算修复工具 =====');

  var snapData = snapSheet.getRange(2, 1, snapSheet.getLastRow() - 1, BUDGET_SNAPSHOT_HEADERS.length).getValues();
  var exactMap = {};
  var campaignDateMap = {};

  for (var s = 0; s < snapData.length; s++) {
    var snapDate = toDateStr_(snapData[s][0]);
    var snapCid = normalizeCustomerId_(snapData[s][1]);
    var snapCampId = safeStr_(snapData[s][COL_BUDGET_SNAPSHOT_CAMPAIGN_ID]).trim();
    var snapBudget = snapData[s][9];
    if (!snapDate || !snapCid || !snapCampId) { continue; }
    if (snapBudget === '' || snapBudget === null || snapBudget === undefined) { continue; }

    var exactKey = snapDate + '|' + snapCid + '|' + snapCampId;
    exactMap[exactKey] = snapBudget;

    var campKey = snapCid + '|' + snapCampId;
    if (!campaignDateMap[campKey]) { campaignDateMap[campKey] = []; }
    campaignDateMap[campKey].push({ date: snapDate, budget: snapBudget });
  }

  for (var ck in campaignDateMap) {
    campaignDateMap[ck].sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  console.log('快照数据: ' + snapData.length + ' 行, 精确映射 ' + Object.keys(exactMap).length + ' 条');

  var reportSheet = ss.getSheetByName(SHEET_REPORT);
  if (!reportSheet || reportSheet.getLastRow() <= 1) {
    console.log('⚠️ raw_daily_report 表无数据');
    return;
  }

  var reportData = reportSheet.getRange(2, 1, reportSheet.getLastRow() - 1, REPORT_HEADERS.length).getValues();
  var exactFilled = 0;
  var nearestFilled = 0;
  var unfilled = 0;
  var alreadyHas = 0;

  for (var r = 0; r < reportData.length; r++) {
    var currentBudget = reportData[r][COL_REPORT_CAMPAIGN_BUDGET];
    if (currentBudget !== '' && currentBudget !== null && currentBudget !== undefined && currentBudget !== 0) {
      alreadyHas++;
      continue;
    }

    var rowDate = toDateStr_(reportData[r][COL_DATE]);
    var rowCid = normalizeCustomerId_(reportData[r][COL_CUSTOMER_ID]);
    var rowCampId = safeStr_(reportData[r][COL_REPORT_CAMPAIGN_ID]).trim();
    if (!rowDate || !rowCid || !rowCampId) { continue; }

    var exactKey = rowDate + '|' + rowCid + '|' + rowCampId;
    if (Object.prototype.hasOwnProperty.call(exactMap, exactKey)) {
      reportData[r][COL_REPORT_CAMPAIGN_BUDGET] = exactMap[exactKey];
      exactFilled++;
      continue;
    }

    var campKey = rowCid + '|' + rowCampId;
    var entries = campaignDateMap[campKey];
    if (entries && entries.length > 0) {
      var nearest = findNearestBudget_(entries, rowDate);
      if (nearest !== null) {
        reportData[r][COL_REPORT_CAMPAIGN_BUDGET] = nearest;
        nearestFilled++;
        continue;
      }
    }

    unfilled++;
  }

  console.log('扫描报告行: ' + reportData.length);
  console.log('已有预算: ' + alreadyHas);
  console.log('精确回填(日期匹配): ' + exactFilled);
  console.log('就近回填(最近快照): ' + nearestFilled);
  console.log('无法回填(无快照): ' + unfilled);

  if (exactFilled + nearestFilled > 0) {
    var batchSize = Math.max(500, WRITE_BATCH_SIZE);
    for (var b = 0; b < reportData.length; b += batchSize) {
      var chunk = reportData.slice(b, b + batchSize);
      reportSheet.getRange(2 + b, 1, chunk.length, REPORT_HEADERS.length).setValues(chunk);
    }
    SpreadsheetApp.flush();
    console.log('✅ 已写回 ' + (exactFilled + nearestFilled) + ' 行预算修复');
  } else {
    console.log('ℹ️ 无需修复');
  }

  console.log('===== 修复完成 =====');
}

/**
 * 在已排序的快照条目中查找离目标日期最近的预算（优先取不晚于目标日期的最近一条）。
 * @param {!Array<{date:string, budget:*}>} entries 按日期升序排列的快照条目。
 * @param {string} targetDate 目标日期。
 * @return {*} 预算值，无匹配时返回 null。
 */
function findNearestBudget_(entries, targetDate) {
  var bestBefore = null;
  var bestAfter = null;

  for (var i = 0; i < entries.length; i++) {
    if (entries[i].date <= targetDate) {
      bestBefore = entries[i].budget;
    } else if (bestAfter === null) {
      bestAfter = entries[i].budget;
    }
  }

  return bestBefore !== null ? bestBefore : bestAfter;
}
