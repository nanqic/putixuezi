# 关键词搜索 API（search-api）

`/search/` 页的后端：Cloudflare Worker `putixuezi-search` + D1 数据库 `putixuezi-search`，取代原来构建时生成的 pagefind 索引（站点过大，pagefind 在 Vercel 构建时内存不足）。

由 hdcx 的 `workers/fayu-api` 移植：`src/normalize.js`、`src/search.js`、`src/t2s.js`、`schema.sql` 与其相同；去掉了视频字幕部分，导入脚本改为读取 mkdocs 构建产物。匹配规则（繁简、去标点、多词同篇、高亮片段）见 hdcx 该目录的 README。

| 文件 | 作用 |
| :--- | :--- |
| `scripts/import.mjs` | 读取 `site/` 各页正文，分块生成 `out/import.sql` 并导入 D1 |
| `src/index.js` | Worker：`GET /search?q=&page=&size=&c=`、`GET /meta` |
| `docs/assets/javascripts/keyword-search.js` | 前端：搜索页 + 文章页按 `?p=段落号&hl=关键词` 跳转高亮 |
| `docs/search.md` | 搜索页，`data-api` 为 Worker 地址 |

- **分类**：页面面包屑的第二项（导航顶级栏目，如「问答」「论典讲解」）；只有一级的页面以自身标题为分类
- **段落号**：正文中 `p, li, dt, dd, td, th, h2~h6` 里不再包含同类元素的叶子元素依次编号。`import.mjs` 与 `keyword-search.js` 的 `UNIT_SELECTOR` 须保持一致，否则跳转错位

## 首次部署

密钥放在本目录的 `.env.local`（已被 git 忽略，不要提交）：

```
CLOUDFLARE_API_TOKEN=…     # 权限：Account → D1 Edit、Workers Scripts Edit、Account Settings Read
CLOUDFLARE_ACCOUNT_ID=…    # 账号下有多个 Account 时必填
```

```bash
cd workers/search-api
npm install
node --env-file=.env.local node_modules/wrangler/bin/wrangler.js d1 create putixuezi-search   # 把输出的 database_id 填入 wrangler.toml
npm run deploy             # 输出的 https://putixuezi-search.<子域>.workers.dev 填入 docs/search.md 的 data-api
```

## 内容更新后

```bash
mkdocs build               # 仓库根目录
cd workers/search-api
npm run import             # 重新生成并导入远程 D1（清空旧数据后整体写入）
```

- 导入后数据版本（内容哈希）改变，Worker 一分钟内发现，结果缓存自动失效，无需重新部署
- `npm run import -- --dry` 只生成 SQL；`--local` 导入本地 D1，配合 `npm run dev`（http://127.0.0.1:8787）调试
- 改了 `src/normalize.js` 或 `t2s.js` 须重新导入再部署

## 额度

约 3100 篇、2600 万字，3200 块，SQL 约 140MB（D1 免费版单库上限 500MB）。每次未命中缓存的搜索扫描 `block_norms` 全表约 3200 行，D1 免费额度每天读 500 万行，约可搜 1500 次（相同查询走边缘缓存不计）。不够时可升级 Workers 付费版，或把小文章合并进同一块以减少行数。
