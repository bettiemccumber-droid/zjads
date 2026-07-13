import dayjs, { type Dayjs } from 'dayjs';

/**
 * 报表/采集默认结束日：昨天（与 MCC 脚本日常口径一致）
 */
export function defaultReportEnd(): Dayjs {
  return dayjs().subtract(1, 'day').startOf('day');
}

/**
 * 员工端默认区间：近 7 天（含昨天）
 */
export function employeeDefaultDateRange(): [Dayjs, Dayjs] {
  const end = defaultReportEnd();
  return [end.subtract(6, 'day'), end];
}

/**
 * 管理员端默认区间：本月（月初至昨天）
 */
export function adminDefaultDateRange(): [Dayjs, Dayjs] {
  const end = defaultReportEnd();
  return [dayjs().startOf('month'), end];
}

/**
 * 近 N 天（含昨天）
 */
export function lastNDaysToYesterday(days: number): [Dayjs, Dayjs] {
  const end = defaultReportEnd();
  return [end.subtract(days - 1, 'day'), end];
}
