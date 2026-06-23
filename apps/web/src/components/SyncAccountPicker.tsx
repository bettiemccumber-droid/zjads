import { Button, Checkbox } from 'antd';
import './SyncAccountPicker.css';

const PLATFORM_CODES = ['partnermatic', 'linkhaitao', 'linkbux', 'rewardoo'] as const;

const PLATFORM_SHORT: Record<string, string> = {
  partnermatic: 'PM',
  linkhaitao: 'LH',
  linkbux: 'LB',
  rewardoo: 'RW',
};

export interface SyncAccountPick {
  id: number;
  platformCode: string;
  platformName: string;
  displayName: string;
  affiliateAlias: string;
}

interface SyncAccountPickerProps {
  accounts: SyncAccountPick[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}

/**
 * 采集范围：平台卡片多选 + 快捷筛选
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

  return (
    <div className="sync-scope-panel">
      <div className="sync-scope-header">
        <div>
          <div className="sync-scope-title">采集范围</div>
          <div className="sync-scope-desc">可只选单个平台重采，无需每次全平台一起跑</div>
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
        {accounts.map((a) => {
          const checked = selectedIds.includes(a.id);
          const code = a.platformCode as (typeof PLATFORM_CODES)[number];
          return (
            <label
              key={a.id}
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
        })}
      </Checkbox.Group>
    </div>
  );
}
