import { TeamOutlined, UserOutlined } from '@ant-design/icons';
import { Card, Select, Space, Tag, Typography } from 'antd';
import { useMemo } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { AuthUser } from '../hooks/useAuth';
import { canScopeTeamMembers, parseScopedViewUserId } from '../utils/team-scope.util';

interface TeamMemberScopeSelectProps {
  user: AuthUser | null;
  isAdmin: boolean;
  /** 当前路径（不含 query），用于切换成员时保留其它 search 参数 */
  basePath?: string;
  /** 嵌入 AppLayout 时不加外边距 */
  embedded?: boolean;
}

/** 组长可切换查看组员的页面 */
export const TEAM_SCOPE_PATHS = [
  '/dashboard',
  '/settlement',
  '/channel-accounts',
  '/ad-sources',
  '/merchants',
];

/**
 * 组长工作台：切换查看直属组员数据（只读）
 */
export default function TeamMemberScopeSelect({
  user,
  isAdmin,
  basePath,
  embedded = false,
}: TeamMemberScopeSelectProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const members = user?.teamMembers ?? [];
  const showBar = canScopeTeamMembers(user, isAdmin) && !isAdmin && members.length > 0;

  const path = basePath ?? location.pathname;
  const onScopeRoute =
    embedded &&
    TEAM_SCOPE_PATHS.some((p) => location.pathname === p || location.pathname.startsWith(`${p}/`));

  const viewUserId = parseScopedViewUserId(user, isAdmin, searchParams.get('userId'));
  const viewingSelf = viewUserId == null || viewUserId === user?.id;
  const viewedMember = members.find((m) => m.id === viewUserId);

  const options = useMemo(() => {
    if (!user) return [];
    return [
      {
        value: user.id,
        label: (
          <Space>
            <UserOutlined />
            <span>我的数据</span>
            <Typography.Text type="secondary">（{user.username}）</Typography.Text>
          </Space>
        ),
      },
      ...members.map((m) => ({
        value: m.id,
        label: (
          <Space>
            <TeamOutlined />
            <span>组员</span>
            <Typography.Text strong>{m.username}</Typography.Text>
          </Space>
        ),
      })),
    ];
  }, [members, user]);

  if (!showBar) return null;
  if (embedded && !onScopeRoute) return null;
  if (!user) return null;

  const selectValue = viewingSelf ? user.id : viewUserId;

  const onChange = (id: number) => {
    const next = new URLSearchParams(searchParams);
    if (id === user?.id) {
      next.delete('userId');
      next.delete('username');
    } else {
      next.set('userId', String(id));
      const name = members.find((m) => m.id === id)?.username;
      if (name) next.set('username', name);
    }
    const q = next.toString();
    navigate(q ? `${path}?${q}` : path, { replace: true });
  };

  return (
    <Card
      size="small"
      style={{
        marginBottom: embedded ? 0 : 16,
        borderColor: '#91caff',
        background: 'linear-gradient(90deg, #f0f5ff 0%, #ffffff 100%)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <Space direction="vertical" size={4} style={{ flex: 1, minWidth: 220 }}>
          <Space wrap>
            <Tag color="processing" icon={<TeamOutlined />}>
              组长工作台
            </Tag>
            <Typography.Text strong>组员数据查看（只读）</Typography.Text>
          </Space>
          <Typography.Text type="secondary" style={{ fontSize: 13 }}>
            {viewingSelf ? (
              <>
                您名下有 <Typography.Text strong>{members.length}</Typography.Text>{' '}
                名组员；切换后可查看其广告、结算、平台绑定与 Sheet 配置，无法代操作采集或改 Token。
              </>
            ) : (
              <>
                当前查看组员{' '}
                <Typography.Text strong type="warning">
                  {viewedMember?.username ?? searchParams.get('username') ?? viewUserId}
                </Typography.Text>{' '}
                的数据
              </>
            )}
          </Typography.Text>
        </Space>
        <Space wrap align="center">
          <Typography.Text type="secondary">切换对象</Typography.Text>
          <Select
            size="large"
            style={{ minWidth: 240 }}
            value={selectValue}
            options={options}
            onChange={onChange}
            popupMatchSelectWidth={280}
          />
        </Space>
      </div>
    </Card>
  );
}
