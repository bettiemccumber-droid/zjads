import { Button, Checkbox } from 'antd';
import './MerchantAccountPicker.css';

const PLATFORM_CODES = ['partnermatic', 'linkhaitao', 'linkbux', 'rewardoo', 'ultrainfluence'] as const;

const PLATFORM_SHORT: Record<string, string> = {
  partnermatic: 'PM',
  linkhaitao: 'LH',
  linkbux: 'LB',
  rewardoo: 'RW',
  ultrainfluence: 'UI',
};

export interface MerchantAccountPick {
  id: number;
  platformCode: string;
  platformName: string;
  displayName: string;
  affiliateAlias: string;
  statusQuerySupported: boolean;
}

interface MerchantAccountPickerProps {
  accounts: MerchantAccountPick[];
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}

/**
 * 商家状态查询：平台账号卡片多选 + 快捷筛选
 */
export default function MerchantAccountPicker({
  accounts,
  selectedIds,
  onChange,
}: MerchantAccountPickerProps) {
  const supported = accounts.filter((a) => a.statusQuerySupported);

  if (!accounts.length) return null;

  const selectAll = () => onChange(supported.map((a) => a.id));

  const selectPlatform = (code: string) => {
    onChange(supported.filter((a) => a.platformCode === code).map((a) => a.id));
  };

  const isAllSelected =
    supported.length > 0 &&
    selectedIds.length === supported.length &&
    supported.every((a) => selectedIds.includes(a.id));

  const isPlatformOnly = (code: string) => {
    const ids = supported.filter((a) => a.platformCode === code).map((a) => a.id);
    return (
      ids.length > 0 &&
      selectedIds.length === ids.length &&
      ids.every((id) => selectedIds.includes(id))
    );
  };

  return (
    <div className="merchant-account-panel">
      <div className="merchant-account-header">
        <div>
          <div className="merchant-account-title">平台账号</div>
          <div className="merchant-account-desc">
            在所选账号中查询 Join 状态与商家上架情况
          </div>
        </div>
        <div className="merchant-account-meta">
          <span className="merchant-account-count">
            已选 {selectedIds.length}/{supported.length}
          </span>
          <div className="merchant-account-quick">
            <Button size="small" type={isAllSelected ? 'primary' : 'default'} onClick={selectAll}>
              全选
            </Button>
            {PLATFORM_CODES.map((code) => {
              const has = supported.some((a) => a.platformCode === code);
              if (!has) return null;
              return (
                <Button
                  key={code}
                  size="small"
                  type={isPlatformOnly(code) ? 'primary' : 'default'}
                  onClick={() => selectPlatform(code)}
                >
                  仅 {PLATFORM_SHORT[code]}
                </Button>
              );
            })}
          </div>
        </div>
      </div>

      <Checkbox.Group
        value={selectedIds}
        onChange={(vals) => onChange(vals as number[])}
        className="merchant-account-grid"
      >
        {accounts.map((a) => {
          const checked = selectedIds.includes(a.id);
          const code = a.platformCode as (typeof PLATFORM_CODES)[number];
          const disabled = !a.statusQuerySupported;
          return (
            <label
              key={a.id}
              className={`merchant-account-card ${checked ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
            >
              <Checkbox value={a.id} disabled={disabled} />
              <span className="merchant-account-card-body">
                <span className={`merchant-platform-badge ${code}`}>
                  {PLATFORM_SHORT[a.platformCode] ?? a.platformCode}
                </span>
                <span className="merchant-account-name">{a.platformName}</span>
                <span className="merchant-account-alias">
                  {a.displayName} · {a.affiliateAlias}
                </span>
                {disabled ? <span className="merchant-account-unsupported">暂不支持状态查询</span> : null}
              </span>
            </label>
          );
        })}
      </Checkbox.Group>
    </div>
  );
}
