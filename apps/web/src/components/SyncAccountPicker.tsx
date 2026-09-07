import { Button, Checkbox, Tooltip } from 'antd';
import './SyncAccountPicker.css';
import {
  countSelectedDeploymentUnits,
  groupAccountsByDeploymentUnit,
} from '../utils/deployment-unit.util';

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

function formatChannelTooltip(members: SyncAccountPick[]): string {
  if (members.length === 1) {
    return `Channel：${channelLabel(members[0])}`;
  }
  return members.map((a) => channelLabel(a)).join('\n');
}

function isPlatformFullySelected(
  accounts: SyncAccountPick[],
  selectedIds: number[],
  code: string,
): boolean {
  const platformIds = accounts.filter((a) => a.platformCode === code).map((a) => a.id);
  return platformIds.length > 0 && platformIds.every((id) => selectedIds.includes(id));
}

/**
 * 采集范围：投放单元卡片；快捷筛选固定在标题栏右侧
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

  const selectedUnitCount = countSelectedDeploymentUnits(selectedIds, accounts);
  const totalUnitCount = groups.length;
  const allSelected = selectedUnitCount === totalUnitCount;

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
      <div className="sync-scope-toolbar">
        <div className="sync-scope-heading">
          <span className="sync-scope-title">采集范围</span>
          <span className={`sync-scope-stat${allSelected ? ' sync-scope-stat--full' : ''}`}>
            {selectedUnitCount}/{totalUnitCount} 已选
          </span>
        </div>
        <div className="sync-scope-quick">
          <Button
            size="small"
            type={allSelected ? 'primary' : 'default'}
            ghost={allSelected}
            onClick={selectAll}
          >
            全选
          </Button>
          {PLATFORM_CODES.map((code) => {
            const has = accounts.some((a) => a.platformCode === code);
            if (!has) return null;
            const active = isPlatformFullySelected(accounts, selectedIds, code);
            return (
              <Button
                key={code}
                size="small"
                type={active ? 'primary' : 'default'}
                ghost={active}
                className={`sync-scope-quick-btn sync-scope-quick-btn--${code}`}
                onClick={() => selectPlatform(code)}
              >
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
          const code = lead.platformCode;

          return (
            <Tooltip key={unitKey} title={formatChannelTooltip(sorted)} placement="top">
              <label
                className={[
                  'sync-account-card',
                  `sync-account-card--${code}`,
                  checked ? 'selected' : '',
                  partial ? 'partial' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <div className="sync-account-card-top">
                  <span className={`sync-platform-badge ${code}`}>
                    {PLATFORM_SHORT[code] ?? code}
                  </span>
                  <Checkbox
                    className="sync-account-card-check"
                    checked={checked}
                    indeterminate={partial}
                    onChange={(e) => toggleUnit(groupIds, e.target.checked)}
                  />
                </div>
                <span className="sync-account-alias">
                  <span className="sync-account-name">{lead.displayName}</span>
                  <span className="sync-account-alias-sep">·</span>
                  <span className="sync-account-code">{lead.affiliateAlias}</span>
                </span>
                {sorted.length > 1 ? (
                  <span className="sync-account-channel-tag">{sorted.length} 个 Channel</span>
                ) : (
                  <span className="sync-account-channel-hint">{channelLabel(sorted[0])}</span>
                )}
              </label>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
