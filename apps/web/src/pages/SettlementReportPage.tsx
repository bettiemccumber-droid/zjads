import { useEffect, useState } from 'react';
import { Tabs } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { api, type ApiResult } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { parseScopedViewUserId } from '../utils/team-scope.util';
import SettlementClassicMonthlyPanel from './settlement-report/SettlementClassicMonthlyPanel';
import SettlementReportYearlyPanel from './settlement-report/SettlementReportYearlyPanel';
import './settlement-report/settlement-report.css';

interface EmployeeOption {
  id: number;
  username: string;
}

/**
 * 结算报表（月度 · 竞品布局 / 年度汇总）
 */
export default function SettlementReportPage() {
  const { user, isAdmin } = useAuth();
  const [searchParams] = useSearchParams();
  const scopedMemberId = parseScopedViewUserId(user, isAdmin, searchParams.get('userId'));

  const [month] = useState<Dayjs>(() => dayjs().startOf('month'));
  const [scopeUserId, setScopeUserId] = useState<number | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);

  const effectiveScopeUserId = isAdmin ? scopeUserId : scopedMemberId ?? null;

  useEffect(() => {
    if (!isAdmin) return;
    const y = month.year();
    void (async () => {
      const { data } = await api.get<
        ApiResult<Array<{ id: number; username: string; isActive: boolean }>>
      >('/admin/users/summary', {
        params: {
          startDate: `${y}-01-01`,
          endDate: `${y}-12-31`,
        },
      });
      if (data.success) {
        setEmployees(
          data.data.filter((u) => u.isActive).map((u) => ({ id: u.id, username: u.username })),
        );
      }
    })();
  }, [isAdmin, month.year()]);

  return (
    <div className="settlement-report-page">
      <Tabs
        destroyInactiveTabPane
        className="settlement-report-tabs"
        items={[
          {
            key: 'monthly',
            label: '月度报表',
            children: (
              <SettlementClassicMonthlyPanel
                isAdmin={isAdmin}
                effectiveScopeUserId={effectiveScopeUserId}
                employees={employees}
                scopeUserId={scopeUserId}
                onScopeChange={setScopeUserId}
              />
            ),
          },
          {
            key: 'yearly',
            label: '年度报表',
            children: (
              <SettlementReportYearlyPanel
                isAdmin={isAdmin}
                effectiveScopeUserId={effectiveScopeUserId}
                employees={employees}
                scopeUserId={scopeUserId}
                onScopeChange={setScopeUserId}
              />
            ),
          },
          {
            key: 'bank',
            label: '银行流水',
            disabled: true,
            children: null,
          },
        ]}
      />
    </div>
  );
}
