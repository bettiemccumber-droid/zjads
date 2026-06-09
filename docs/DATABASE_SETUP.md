# 数据库初始化说明

## 错误 P3014（影子库权限不足）

`zjads` 用户若只有 `zjads` 库的权限，`prisma migrate dev` 会失败，因为需要临时创建 `prisma_migrate_shadow_db_*` 数据库。

### 方案 A：首次建表用 db push（推荐，无需 CREATE 库权限）

```powershell
cd D:\Code\zjads\apps\api
npx prisma db push
npx prisma generate
npm run prisma:seed
```

或一条命令：

```powershell
npm run db:init
```

### 方案 B：给 zjads 用户授权 CREATE（之后可用 migrate dev）

用 **root** 在 Navicat 执行：

```sql
GRANT CREATE ON *.* TO 'zjads'@'localhost';
FLUSH PRIVILEGES;
```

然后再执行：

```powershell
npx prisma migrate dev --name init
npx prisma generate
npm run prisma:seed
```

### 方案 C：迁移时用 root（.env 临时改 root，完成后改回 zjads）

```env
DATABASE_URL="mysql://root:你的root密码@localhost:3306/zjads"
```

---

## 默认管理员（seed 后）

- 邮箱：`admin@company.local`
- 密码：`Admin123!`（仅开发环境，上线前请修改）
