import { Button, Checkbox } from 'antd';
import './SyncAccountPicker.css';
import { groupAccountsByDeploymentUnit } from '../utils/deployment-unit.util';

const PLATFORM_CODES = ['partnermatic', 'linkhaitao', 'linkbux', 'rewardoo', 'ultrainfluence'] as const;

const PLATFORM_SHORT: Record<string, string> = {
  partnermatic: 'PM',
  linkhaitao: 'LH',
  linkbux: 'LB',
  rewardoo: 'RW',
  ultrainfluence: 'UI',
};

export interface SyncAccountPick {
  id: number;
  platformCode: string;
  platformName: string;
  displayName: string;
  affiliateAlias: string;
  externalChannelId?: string | null;
}

interface SyncAccountPickerProps {
  accounts: SyncAccountPick[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}

/**
 * 采集范围：按投放单元分组（同 displayName+affiliateAlias 的多 Channel 折叠）
 */
export default function SyncAccountPicker({
  accounts,
  selectedIds,
  onChange,
}: SyncAccountPickerProps) {
  if (!accounts.length) return null;

  const selectAll = () => onChange(accounts.map((a) => a.id));

  const selectPlatform = (code: string) => {
    onChange(accounts.filter((a) => a.platformCode === code).map((a) => a.id));
  };

  const grouped = groupAccountsByDeploymentUnit(accounts);
  const groups = [...grouped.entries()].sort((a, b) => {
    const left = a[1][0];
    const right = b[1][0];
    return (
      left.platformName.localeCompare(right.platformName) ||
      left.displayName.localeCompare(right.displayName) ||
      left.affiliateAlias.localeCompare(right.affiliateAlias)
    );
  });

  const toggleGroup = (groupIds: number[], checked: boolean) => {
    if (checked) {
      onChange([...new Set([...selectedIds, ...groupIds])]);
      return;
    }
    const drop = new Set(groupIds);
    onChange(selectedIds.filter((id) => !drop.has(id)));
  };

  return (
    <div className="sync-scope-panel">
      <div className="sync-scope-header">
        <div>
          <div className="sync-scope-title">采集范围</div>
          <div className="sync-scope-desc">
            同显示名称与联盟序号的多 Channel 已合并为一组；采集仍按各 Token 分别执行
          </div>
        </div>
        <div className="sync-scope-quick">
          <Button size="small" onClick={selectAll}>
            全选
          </Button>
          {PLATFORM_CODES.map((code) => {
            const has = accounts.some((a) => a.platformCode === code);
            if (!has) return null;
            return (
              <Button key={code} size="small" onClick={() => selectPlatform(code)}>
                仅 {PLATFORM_SHORT[code]}
              </Button>
            );
          })}
        </div>
      </div>

      <Checkbox.Group
        value={selectedIds}
        onChange={(vals) => onChange(vals as number[])}
        className="sync-account-grid"
      >
        {groups.map(([unitKey, members]) => {
          const sorted = [...members].sort((a, b) => a.id - b.id);
          const groupIds = sorted.map((a) => a.id);
          const allChecked = groupIds.every((id) => selectedIds.includes(id));
          const indeterminate = !allChecked && groupIds.some((id) => selectedIds.includes(id));
          const lead = sorted[0];
          const code = lead.platformCode as (typeof PLATFORM_CODES)[number];

          if (sorted.length === 1) {
            const a = sorted[0];
            const checked = selectedIds.includes(a.id);
            return (
              <label
                key={unitKey}
                className={`sync-account-card ${checked ? 'selected' : ''}`}
              >
                <Checkbox value={a.id} />
                <span className="sync-account-card-body">
                  <span className={`sync-platform-badge ${code}`}>
                    {PLATFORM_SHORT[a.platformCode] ?? a.platformCode}
                  </span>
                  <span className="sync-account-name">{a.platformName}</span>
                  <span className="sync-account-alias">
                    {a.displayName} · {a.affiliateAlias}
                  </span>
                </span>
              </label>
            );
          }

          return (
            <div
              key={unitKey}
              className={`sync-account-group ${allChecked ? 'selected' : ''}`}
            >
              <label className="sync-account-group-header">
                <Checkbox
                  indeterminate={indeterminate}
                  checked={allChecked}
                  onChange={(e) => toggleGroup(groupIds, e.target.checked)}
                />
                <span className="sync-account-card-body">
                  <span className={`sync-platform-badge ${code}`}>
                    {PLATFORM_SHORT[lead.platformCode] ?? lead.platformCode}
                  </span>
                  <span className="sync-account-name">{lead.platformName}</span>
                  <span className="sync-account-alias">
                    {lead.displayName} · {lead.affiliateAlias}
                    <span className="sync-account-channel-count">{sorted.length} 个 Channel</span>
                  </span>
                </span>
              </label>
              <div className="sync-account-group-items">
                {sorted.map((a) => {
                  const checked = selectedIds.includes(a.id);
                  return (
                    <label
                      key={a.id}
                      className={`sync-account-channel-row ${checked ? 'selected' : ''}`}
                    >
                      <Checkbox value={a.id} />
                      <span className="sync-account-channel-label">
                        {a.externalChannelId?.trim() || `Channel #${a.id}`}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </Checkbox.Group>
    </div>
  );
}
