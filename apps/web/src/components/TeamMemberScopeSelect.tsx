import { Select, Space, Typography } from 'antd';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { AuthUser } from '../hooks/useAuth';
import { canScopeTeamMembers } from '../utils/team-scope.util';

interface TeamMemberScopeSelectProps {
  user: AuthUser | null;
  isAdmin: boolean;
  /** 当前路径（不含 query），用于切换成员时保留其它 search 参数 */
  basePath?: string;
}

/**
 * 组长 / 管理员：切换查看的员工数据（仅改 URL userId）
 */
export default function TeamMemberScopeSelect({
  user,
  isAdmin,
  basePath,
}: TeamMemberScopeSelectProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  if (!canScopeTeamMembers(user, isAdmin) || isAdmin) {
    return null;
  }

  const members = user?.teamMembers ?? [];
  if (members.length === 0) return null;

  const raw = searchParams.get('userId');
  const currentId = raw ? parseInt(raw, 10) : user?.id;

  const options = [
    { value: user!.id, label: `自己（${user!.username}）` },
    ...members.map((m) => ({ value: m.id, label: m.username })),
  ];

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
    const path = basePath ?? window.location.pathname;
    navigate(`${path}?${next.toString()}`, { replace: true });
  };

  return (
    <Space style={{ marginBottom: 16 }} wrap>
      <Typography.Text type="secondary">查看成员：</Typography.Text>
      <Select
        style={{ minWidth: 180 }}
        value={Number.isNaN(currentId!) ? user?.id : currentId}
        options={options}
        onChange={onChange}
      />
    </Space>
  );
}
