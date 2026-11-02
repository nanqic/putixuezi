-- 关键词搜索（D1 数据库 putixuezi-search）：站内全部文章（由 hdcx 的 fayu-api 移植）
-- 每篇文章一行元数据（docs）；段落按顺序打包成块，每块原文与规范化文本各不超过约 90KB（D1 单条 SQL 100KB）
-- 同一块拆成两张表：block_norms 只存规范化文本（去空白标点、繁转简，规则见 src/normalize.js），检索时 SQL 全表扫描、按出现次数计数；
-- block_texts 存原文，只按主键取当前页要显示的块。这样每次搜索扫描的行数约为原文与规范化文本同表时的一半
-- 行数受 D1 免费额度约束：每天读 500 万行、写 10 万行，因此不能一段一行
-- 规范化规则或 t2s.js 改动后须重新导入

CREATE TABLE IF NOT EXISTS docs (
    id INTEGER PRIMARY KEY,          -- 导入时按分类、目录顺序编号（每次导入重新编号）
    cat TEXT NOT NULL,               -- 分类：导航顶级栏目名（面包屑第二项），如 问答、论典讲解
    grp TEXT NOT NULL,               -- 分组：面包屑除首页外的路径，如 问答/999答疑专题
    grp_label TEXT NOT NULL,         -- 分组名：面包屑最后一项，如 999答疑专题
    title TEXT NOT NULL,             -- 文章名（页面 h1）
    series TEXT,                     -- 未用（沿用 hdcx 的表结构，恒为 NULL）
    url TEXT,                        -- 页面路径；段落号为正文中第几个段落（规则见 scripts/import.mjs 的 UNIT_SELECTOR）
    units INTEGER NOT NULL           -- 段落数
);

-- 检索用：每次搜索全表扫描
CREATE TABLE IF NOT EXISTS block_norms (
    doc_id INTEGER NOT NULL REFERENCES docs (id),
    seq INTEGER NOT NULL,            -- 块序号
    cat TEXT NOT NULL,               -- 同 docs.cat，统计各分类命中数时免去联表
    norm TEXT NOT NULL,              -- 各条规范化文本直接拼接（文章段落之间加换行，短语不跨段匹配）
    norm_lens TEXT NOT NULL,         -- 各条在 norm 中的长度（UTF-16 单元），逗号分隔
    PRIMARY KEY (doc_id, seq)
);

-- 展示用：与 block_norms 一一对应，只按主键读取
CREATE TABLE IF NOT EXISTS block_texts (
    doc_id INTEGER NOT NULL REFERENCES docs (id),
    seq INTEGER NOT NULL,
    first_unit INTEGER NOT NULL,     -- 块内第一条在文档中的序号（从 0 起）
    marks TEXT NOT NULL,             -- 各段段落号，逗号分隔
    texts TEXT NOT NULL,             -- 各条原文，换行分隔（文章段落内的换行替换为空格）
    PRIMARY KEY (doc_id, seq)
);

-- version：数据内容哈希，Worker 据此让结果缓存失效；updated_at：导入时间
CREATE TABLE IF NOT EXISTS meta (
    name TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
