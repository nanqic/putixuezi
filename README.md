# 菩提学子

本项目使用 **MkDocs + Material for MkDocs** 构建静态文档站。

## 目录结构

```text
├── docs/                 # 文档内容目录
│   ├── README.md         # 站点首页
│   ├── archive/          # 主站内容
│   └── refs/             # refs 子目录内容
├── mkdocs.yml            # 站点配置与导航
```

## 环境准备

```bash
python3 -m pip install --user mkdocs mkdocs-material
```

如果 `mkdocs` 命令找不到，请加入 PATH：

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

## 本地预览

在项目根目录执行：

```bash
mkdocs serve
```

访问：

- <http://127.0.0.1:8000>
- <http://localhost:8000>

## 静态编译

```bash
mkdocs build
```

## 编译并运行

```bash
python3 -m mkdocs build --clean
npx --yes pagefind --site site --output-subdir pagefind
python3 -m http.server 8000 -d site
```

默认输出目录：

- `site/`

如果要指定输出目录：

```bash
mkdocs build --site-dir site-output
```

## 导航维护

### 直接改 `mkdocs.yml`

## 常见问题

1. `mkdocs: command not found`

使用 `~/.local/bin/mkdocs` 或配置 PATH（见上文）。

2. Material 的 MkDocs 2.0 警告

当前属于上游兼容性提示，不影响你在 `mkdocs 1.x` 下构建本站。
