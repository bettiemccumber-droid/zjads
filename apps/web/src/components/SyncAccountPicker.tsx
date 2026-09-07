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

function channelLabel(account: SyncAccountPick): string {
  const id = account.externalChannelId?.trim();
  return id || `#${account.id}`;
}

function formatChannelList(members: SyncAccountPick[]): string {
  return members.map((a) => channelLabel(a)).join('、');
}

/**
 * 采集范围：按投放单元展示；同单元多 Channel 一张卡片、一次勾选（采集仍分 Token 执行）
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

  const toggleUnit = (groupIds: number[], checked: boolean) => {
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
            同显示名称与联盟序号的多 Channel 合并为一张卡片；勾选后会采集该账号下全部 Channel
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

      <div className="sync-account-grid">
        {groups.map(([unitKey, members]) => {
          const sorted = [...members].sort((a, b) => a.id - b.id);
          const groupIds = sorted.map((a) => a.id);
          const checked = groupIds.every((id) => selectedIds.includes(id));
          const partial = !checked && groupIds.some((id) => selectedIds.includes(id));
          const lead = sorted[0];
          const code = lead.platformCode as (typeof PLATFORM_CODES)[number];

          return (
            <label
              key={unitKey}
              className={`sync-account-card ${checked ? 'selected' : ''} ${partial ? 'partial' : ''}`}
            >
              <Checkbox
                checked={checked}
                indeterminate={partial}
                onChange={(e) => toggleUnit(groupIds, e.target.checked)}
              />
              <span className="sync-account-card-body">
                <span className={`sync-platform-badge ${code}`}>
                  {PLATFORM_SHORT[lead.platformCode] ?? lead.platformCode}
                </span>
                <span className="sync-account-name">{lead.platformName}</span>
                <span className="sync-account-alias">
                  {lead.displayName} · {lead.affiliateAlias}
                </span>
                {sorted.length > 1 ? (
                  <span className="sync-account-channel-detail">
                    {sorted.length} 个 Channel：{formatChannelList(sorted)}
                  </span>
                ) : (
                  <span className="sync-account-channel-detail">Channel：{channelLabel(lead)}</span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
