# Write More / 不写就会死

English name: `Write More`; Chinese name: `不写就会死`.

Write More is a desktop-only Obsidian plugin for fiction writers who want a small daily writing dashboard inside their vault. It shows a compact calendar, daily writing statistics, and manually generated Chinese fiction practice prompts. The plugin can generate exercises through the author's Vercel proxy or through a user-provided DeepSeek API key.

## English overview

### Features

- Calendar sidebar for tracking which days have new Markdown writing files.
- Click any date to see that day's word count and number of newly created files.
- Optional daily file list with quick links to open the files.
- Manual fiction exercise generation powered by DeepSeek.
- Practice types: plot, prose, character, pacing, imagination, and free writing.
- One-click note creation for a selected exercise in a configurable target folder.

### Privacy and network access

- By default, exercise generation sends the selected practice type, theme count, model name, and an anonymous client ID to the author's Vercel proxy.
- The Vercel proxy calls `https://api.deepseek.com/chat/completions` with a server-side writing coach prompt.
- The plugin does not upload your vault notes to DeepSeek or to the proxy.
- The plugin reads Markdown files in the current vault to calculate local writing statistics.
- The plugin does not access files outside the vault.
- The plugin does not include telemetry, analytics, advertising, or tracking.
- Users can switch to their own DeepSeek API key in settings. Custom keys are stored locally in Obsidian plugin data and are not additionally encrypted.

### Installation

After the plugin is accepted into the Obsidian community plugin directory, search for `Write More` or `不写就会死` in Obsidian's community plugins browser. For manual installation, download `main.js`, `manifest.json`, and `styles.css` from the GitHub Release and place them in `.obsidian/plugins/write-or-die/`.

一个面向小说写作者的 Obsidian 桌面端插件。它会在右侧边栏显示写作日历、日期写作统计，并通过 DeepSeek 生成每日写作练习题。

## 功能

- 右侧边栏日历，点击日期查看对应日期的新建 Markdown 文件数量和写作字数。
- 有写作记录的日期显示绿色圆点；选中日期显示下划线。
- 今日文件列表可在设置中开启或关闭，默认关闭。
- 支持通过 Vercel 代理或用户自填 DeepSeek Key 生成写作练习。
- 写作练习必须由用户手动生成或重新生成，不会自动定时生成。
- 支持练习类型：剧情练习、文笔练习、角色练习、节奏练习、脑洞练习、随便写写。
- 选择练习后，可一键在指定目录创建写作文件并打开。

## 隐私和网络披露

- 默认生成方式会请求作者配置的 Vercel 代理接口；代理接口再请求 `https://api.deepseek.com/chat/completions`。
- 用户也可以在设置中切换为自填 DeepSeek API Key，并由插件直接请求 DeepSeek。
- 请求内容只包含插件内置的写作教练提示词、练习类型、主题数量和生成要求。
- 插件不会把你的 vault 笔记内容发送给 DeepSeek。
- 代理模式会发送匿名 `clientId`，用于未来额度控制，不绑定用户身份。
- 自填 DeepSeek API Key 保存在本地 Obsidian 插件数据中，不会写入笔记文件，也不会额外加密。
- 插件不包含遥测、广告或使用分析。
- 插件只通过 Obsidian Vault API 读取 vault 内 Markdown 文件的创建时间和内容字数，不访问 vault 外文件。
- 当前代理模式暂不限流，未来可能调整免费额度；自填 Key 模式产生的费用由用户 DeepSeek 账户承担。

## 安装

### 社区插件

发布到 Obsidian 社区插件目录后，可在 Obsidian 的社区插件市场中搜索 `Write More` 或「不写就会死」并安装。

### 手动安装

1. 下载 release 中的 `main.js`、`manifest.json`、`styles.css`。
2. 将这三个文件放到 vault 的 `.obsidian/plugins/write-or-die/` 目录。
3. 在 Obsidian 设置中启用「不写就会死」。

## 设置

- `练习生成方式`：选择官方免费额度（Vercel 代理）或自填 DeepSeek Key。
- `Vercel 代理地址`：使用官方免费额度时调用的后端地址。
- `DeepSeek API Key`：选择自填 DeepSeek Key 时使用。
- `写作文件目录`：练习文件创建目录，默认 `写作主题`。
- `显示今日文件列表`：控制侧边栏是否显示选中日期的新建文件列表，默认关闭。
- `默认练习类型`：侧边栏手动生成主题时使用的练习类型。
- `每日主题数量`：每次生成的练习数量。
- `DeepSeek 模型`：可选 `deepseek-v4-flash` 或 `deepseek-v4-pro`。

## 开发

```bash
npm install
npm run build
npm test
```

## Vercel 代理部署

本仓库包含 `api/generate-themes.ts`，可作为 Vercel Serverless Function 部署。

1. 在 Vercel 中导入本仓库。
2. 在 Project Settings → Environment Variables 中添加 `DEEPSEEK_API_KEY`。
3. 部署后，将插件设置里的 `Vercel 代理地址` 配置为：

```text
https://obsidian-write.vercel.app/api/generate-themes
```

本地开发可参考 `.env.example` 创建 `.env.local`，但不要提交 `.env.local`。

## 发布

创建 GitHub Release 时，需要上传以下附件：

- `main.js`
- `manifest.json`
- `styles.css`

`main.js` 是构建产物，不提交到源码仓库。

## License

MIT
