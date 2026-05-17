import {
  App,
  ItemView,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  TFolder,
  WorkspaceLeaf,
  normalizePath,
  setIcon
} from "obsidian";
import {
  DEFAULT_GENERATION_PROVIDER,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_PRACTICE_TYPE,
  GENERATION_PROVIDERS,
  PRACTICE_TYPES,
  GenerationProvider,
  PracticeType,
  THEME_GENERATION_SYSTEM_PROMPT,
  WritingTheme,
  buildThemeGenerationPrompt,
  buildNotePath,
  countWritingUnits,
  createClientId,
  extractThemesFromPayload,
  getLocalDateKey,
  isThemeCacheCurrent,
  makeUniquePath,
  normalizeDeepSeekModel,
  normalizeFolderPath,
  normalizeGenerationProvider,
  normalizePracticeType,
  parseThemesResponse
} from "./core";

const VIEW_TYPE_WRITE_OR_DIE = "write-or-die-view";

interface ThemeCache {
  date: string;
  practiceType?: PracticeType;
  themes: WritingTheme[];
}

interface WriteOrDieSettings {
  deepseekApiKey: string;
  targetFolder: string;
  themeCount: number;
  model: string;
  showTodayFiles: boolean;
  selectedPracticeType: PracticeType;
  generationProvider: GenerationProvider;
  proxyEndpoint: string;
  clientId: string;
  themeCache: ThemeCache | null;
}

interface TodayFileStat {
  file: TFile;
  wordCount: number;
}

const DEFAULT_SETTINGS: WriteOrDieSettings = {
  deepseekApiKey: "",
  targetFolder: "写作主题",
  themeCount: 5,
  model: DEFAULT_DEEPSEEK_MODEL,
  showTodayFiles: false,
  selectedPracticeType: DEFAULT_PRACTICE_TYPE,
  generationProvider: DEFAULT_GENERATION_PROVIDER,
  proxyEndpoint: "https://write-more-api.vercel.app/api/generate-themes",
  clientId: "",
  themeCache: null
};

export default class WriteOrDiePlugin extends Plugin {
  settings: WriteOrDieSettings;
  lastError = "";
  isGeneratingThemes = false;
  generationStatusText = "";
  private refreshTimer: number | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_WRITE_OR_DIE, (leaf) => new WriteOrDieView(leaf, this));

    this.addRibbonIcon("calendar-days", "打开不写就会死", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-write-or-die-sidebar",
      name: "打开侧边栏",
      callback: () => {
        void this.activateView();
      }
    });

    this.addCommand({
      id: "generate-writing-themes",
      name: "生成今日练习",
      callback: () => {
        void this.generateThemes(true).catch((error) => {
          new Notice(error instanceof Error ? error.message : "练习生成失败。");
        });
      }
    });

    this.addSettingTab(new WriteOrDieSettingTab(this.app, this));

    this.registerEvent(this.app.vault.on("create", () => this.queueRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.queueRefresh()));
    this.registerEvent(this.app.vault.on("modify", () => this.queueRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.queueRefresh()));

    this.app.workspace.onLayoutReady(() => {
      void this.activateView();
    });
  }

  onunload(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async loadSettings(): Promise<void> {
    let shouldSave = false;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(await this.loadData())
    };

    const selectedPracticeType = normalizePracticeType(this.settings.selectedPracticeType);
    if (this.settings.selectedPracticeType !== selectedPracticeType) {
      this.settings.selectedPracticeType = selectedPracticeType;
      shouldSave = true;
    }

    const generationProvider = normalizeGenerationProvider(this.settings.generationProvider);
    if (this.settings.generationProvider !== generationProvider) {
      this.settings.generationProvider = generationProvider;
      shouldSave = true;
    }

    const model = normalizeDeepSeekModel(this.settings.model);
    if (this.settings.model !== model) {
      this.settings.model = model;
      shouldSave = true;
    }

    if (!this.settings.clientId) {
      this.settings.clientId = createClientId();
      shouldSave = true;
    }

    if (this.settings.themeCache) {
      this.settings.themeCache.practiceType = normalizePracticeType(this.settings.themeCache.practiceType);
    }

    if (shouldSave) {
      await this.saveData(this.settings);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.queueRefresh();
  }

  async activateView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_WRITE_OR_DIE);

    if (leaves.length === 0) {
      const leaf = this.app.workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE_WRITE_OR_DIE, active: true });
    }

    const [leaf] = this.app.workspace.getLeavesOfType(VIEW_TYPE_WRITE_OR_DIE);
    if (leaf) {
      this.app.workspace.revealLeaf(leaf);
    }
  }

  queueRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshViews();
    }, 150);
  }

  async refreshViews(): Promise<void> {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_WRITE_OR_DIE)) {
      const view = leaf.view;
      if (view instanceof WriteOrDieView) {
        await view.render();
      }
    }
  }

  async getStatsForDate(dateKey: string): Promise<TodayFileStat[]> {
    const dateFiles = this.app.vault
      .getMarkdownFiles()
      .filter((file) => getLocalDateKey(new Date(file.stat.ctime)) === dateKey)
      .sort((a, b) => a.basename.localeCompare(b.basename, "zh-CN"));

    const stats: TodayFileStat[] = [];
    for (const file of dateFiles) {
      const content = await this.app.vault.cachedRead(file);
      stats.push({ file, wordCount: countWritingUnits(content) });
    }

    return stats;
  }

  getMonthFileCounts(year: number, monthIndex: number): Map<string, number> {
    const counts = new Map<string, number>();

    for (const file of this.app.vault.getMarkdownFiles()) {
      const created = new Date(file.stat.ctime);
      if (created.getFullYear() !== year || created.getMonth() !== monthIndex) {
        continue;
      }

      const dateKey = getLocalDateKey(created);
      counts.set(dateKey, (counts.get(dateKey) ?? 0) + 1);
    }

    return counts;
  }

  async generateThemes(force: boolean, practiceType = this.settings.selectedPracticeType): Promise<WritingTheme[]> {
    const today = getLocalDateKey();
    const cached = this.settings.themeCache;
    const selectedPracticeType = normalizePracticeType(practiceType);

    this.settings.selectedPracticeType = selectedPracticeType;

    if (this.isGeneratingThemes) {
      new Notice("练习正在生成中。");
      return cached?.themes ?? [];
    }

    if (
      !force &&
      cached &&
      isThemeCacheCurrent(today, selectedPracticeType, cached.date, cached.practiceType) &&
      cached.themes.length > 0
    ) {
      return cached.themes;
    }

    this.lastError = "";
    this.isGeneratingThemes = true;
    this.generationStatusText = `正在生成「${selectedPracticeType}」练习...`;
    await this.refreshViews();

    try {
      const themes =
        this.settings.generationProvider === "vercel-proxy"
          ? await this.requestThemesViaProxy(selectedPracticeType)
          : await this.requestThemesViaCustomKey(selectedPracticeType);
      this.settings.themeCache = { date: today, practiceType: selectedPracticeType, themes };
      await this.saveSettings();
      new Notice("今日练习已生成。");
      return themes;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "练习生成失败。";
      throw error;
    } finally {
      this.isGeneratingThemes = false;
      this.generationStatusText = "";
      await this.refreshViews();
    }
  }

  private async requestThemesViaProxy(selectedPracticeType: PracticeType): Promise<WritingTheme[]> {
    const endpoint = this.settings.proxyEndpoint.trim();
    if (!endpoint) {
      throw new Error("请在设置中填写 Vercel 代理地址，或切换为自填 DeepSeek Key。");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        practiceType: selectedPracticeType,
        themeCount: this.settings.themeCount,
        model: this.settings.model,
        clientId: this.settings.clientId
      })
    });

    if (!response.ok) {
      const detail = await safeReadResponseText(response);
      throw new Error(`Vercel 代理请求失败：${response.status}${detail ? ` ${detail.slice(0, 120)}` : ""}`);
    }

    const payload = await response.json();
    return extractThemesFromPayload(payload, this.settings.themeCount);
  }

  private async requestThemesViaCustomKey(selectedPracticeType: PracticeType): Promise<WritingTheme[]> {
    if (!this.settings.deepseekApiKey.trim()) {
      throw new Error("请先在插件设置中填写 DeepSeek API Key。");
    }

    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.deepseekApiKey.trim()}`
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages: [
          {
            role: "system",
            content: THEME_GENERATION_SYSTEM_PROMPT
          },
          {
            role: "user",
            content: buildThemeGenerationPrompt(this.settings.themeCount, selectedPracticeType)
          }
        ],
        thinking: { type: "disabled" },
        response_format: { type: "json_object" },
        stream: false,
        max_tokens: 1200
      })
    });

    if (!response.ok) {
      const detail = await safeReadResponseText(response);
      throw new Error(`DeepSeek 请求失败：${response.status}${detail ? ` ${detail.slice(0, 120)}` : ""}`);
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("DeepSeek 没有返回主题内容。");
    }

    return parseThemesResponse(content, this.settings.themeCount);
  }

  async createNoteFromTheme(theme: WritingTheme): Promise<void> {
    const dateKey = getLocalDateKey();
    const folder = normalizePath(normalizeFolderPath(this.settings.targetFolder));
    const basePath = normalizePath(buildNotePath(folder, dateKey, theme.title));
    const path = makeUniquePath(basePath, (candidate) => this.app.vault.getAbstractFileByPath(candidate) !== null);

    if (folder.length > 0) {
      await this.ensureFolder(folder);
    }

    const content = [
      `# ${theme.title}`,
      "",
      `生成日期：${dateKey}`,
      `练习类型：${this.settings.selectedPracticeType}`,
      "",
      "## 写作提示",
      "",
      theme.prompt,
      "",
      "## 正文",
      ""
    ].join("\n");

    const file = await this.app.vault.create(path, content);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
    new Notice(`已创建：${file.basename}`);
    this.queueRefresh();
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const parts = folderPath.split("/").filter(Boolean);
    let current = "";

    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);

      if (existing instanceof TFolder) {
        continue;
      }

      if (existing) {
        throw new Error(`${current} 已存在但不是文件夹。`);
      }

      await this.app.vault.createFolder(current);
    }
  }
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

class WriteOrDieView extends ItemView {
  private selectedDate = getLocalDateKey();
  private visibleMonth = new Date();

  constructor(leaf: WorkspaceLeaf, private readonly plugin: WriteOrDiePlugin) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_WRITE_OR_DIE;
  }

  getDisplayText(): string {
    return "不写就会死";
  }

  getIcon(): string {
    return "calendar-days";
  }

  async onOpen(): Promise<void> {
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("write-or-die-view");

    const overviewPanel = container.createDiv({ cls: "write-or-die-panel write-or-die-overview-panel" });
    const header = overviewPanel.createDiv({ cls: "write-or-die-header" });
    header.createEl("h2", { text: "今天写了吗？" });
    await this.renderCalendarStats(overviewPanel);

    container.createDiv({ cls: "write-or-die-divider" });

    const practicePanel = container.createDiv({ cls: "write-or-die-panel write-or-die-practice-panel" });
    this.renderThemes(practicePanel);
  }

  private async renderCalendarStats(container: Element): Promise<void> {
    const now = new Date();
    const year = this.visibleMonth.getFullYear();
    const month = this.visibleMonth.getMonth();
    const today = getLocalDateKey(now);
    const counts = this.plugin.getMonthFileCounts(year, month);
    const selectedDate = this.selectedDate;
    const stats = await this.plugin.getStatsForDate(selectedDate);
    const totalWords = stats.reduce((sum, item) => sum + item.wordCount, 0);
    const section = container.createDiv({ cls: "write-or-die-section" });

    const monthHeader = section.createDiv({ cls: "write-or-die-month-header" });
    const prevButton = monthHeader.createEl("button", {
      cls: "write-or-die-month-button",
      attr: { type: "button", "aria-label": "上个月", title: "上个月" }
    });
    setIcon(prevButton, "chevron-left");
    monthHeader.createEl("h3", { text: `${year} 年 ${month + 1} 月` });
    const nextButton = monthHeader.createEl("button", {
      cls: "write-or-die-month-button",
      attr: { type: "button", "aria-label": "下个月", title: "下个月" }
    });
    setIcon(nextButton, "chevron-right");
    prevButton.addEventListener("click", () => {
      this.changeVisibleMonth(-1);
      void this.render();
    });
    nextButton.addEventListener("click", () => {
      this.changeVisibleMonth(1);
      void this.render();
    });

    const calendar = section.createDiv({ cls: "write-or-die-calendar" });
    for (const day of ["日", "一", "二", "三", "四", "五", "六"]) {
      calendar.createDiv({ text: day, cls: "write-or-die-weekday" });
    }

    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let index = 0; index < firstWeekday; index += 1) {
      calendar.createDiv({ cls: "write-or-die-day write-or-die-empty-day" });
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dayEl = calendar.createEl("button", {
        cls: `write-or-die-day${dateKey === today ? " is-today" : ""}${dateKey === selectedDate ? " is-selected" : ""}${counts.has(dateKey) ? " has-files" : ""}`,
        attr: {
          "aria-label": `${dateKey} 写作统计`,
          "aria-pressed": dateKey === selectedDate ? "true" : "false",
          type: "button"
        }
      });
      dayEl.createSpan({ text: String(day), cls: "write-or-die-day-number" });
      dayEl.addEventListener("click", () => {
        this.selectedDate = dateKey;
        void this.render();
      });

      if (counts.has(dateKey)) {
        dayEl.createSpan({ cls: "write-or-die-day-dot" });
      }
    }

    section.createDiv({ text: this.formatSelectedDate(selectedDate, today), cls: "write-or-die-selected-date" });

    const metricRow = section.createDiv({ cls: "write-or-die-metrics" });
    this.createMetric(metricRow, String(totalWords), "写作字数");
    this.createMetric(metricRow, String(stats.length), "文件数量");

    if (!this.plugin.settings.showTodayFiles) {
      return;
    }

    const list = section.createDiv({ cls: "write-or-die-file-list" });
    if (stats.length === 0) {
      list.createDiv({ text: "这天还没有新建 Markdown 文件。", cls: "write-or-die-empty" });
      return;
    }

    for (const item of stats) {
      const button = list.createEl("button", { cls: "write-or-die-file-link" });
      button.createSpan({ text: item.file.basename, cls: "write-or-die-file-name" });
      button.createSpan({ text: `${item.wordCount} 字`, cls: "write-or-die-file-count" });
      button.addEventListener("click", () => {
        void this.app.workspace.getLeaf(false).openFile(item.file);
      });
    }
  }

  private renderThemes(container: Element): void {
    const section = container.createDiv({ cls: "write-or-die-section" });
    section.createEl("h3", { text: "今日练习" });

    const controlRow = section.createDiv({ cls: "write-or-die-theme-controls" });
    const practiceSelect = controlRow.createEl("select", { cls: "write-or-die-practice-select" });
    for (const practiceType of PRACTICE_TYPES) {
      const option = practiceSelect.createEl("option", { text: practiceType, value: practiceType });
      option.selected = practiceType === this.plugin.settings.selectedPracticeType;
    }
    practiceSelect.disabled = this.plugin.isGeneratingThemes;
    practiceSelect.addEventListener("change", () => {
      this.plugin.settings.selectedPracticeType = normalizePracticeType(practiceSelect.value);
      void this.plugin.saveSettings();
      void this.render();
    });

    const refreshButton = controlRow.createEl("button", { text: "重新生成", cls: "write-or-die-small-button" });
    refreshButton.disabled = this.plugin.isGeneratingThemes;
    refreshButton.addEventListener("click", () => {
      void this.runThemeGeneration(refreshButton);
    });

    if (this.plugin.isGeneratingThemes) {
      const loading = section.createDiv({ cls: "write-or-die-loading" });
      loading.createSpan({ cls: "write-or-die-spinner", attr: { "aria-hidden": "true" } });
      loading.createSpan({ text: this.plugin.generationStatusText || "正在生成练习..." });
    }

    if (this.plugin.lastError) {
      section.createDiv({ text: this.plugin.lastError, cls: "write-or-die-error" });
    }

    const today = getLocalDateKey();
    const cache = this.plugin.settings.themeCache;
    const hasCurrentThemes = Boolean(
      cache &&
        isThemeCacheCurrent(today, this.plugin.settings.selectedPracticeType, cache.date, cache.practiceType) &&
        cache.themes.length > 0
    );

    if (hasCurrentThemes) {
      section.createDiv({
        text: "会替换当前练习列表，不影响已创建文件。",
        cls: "write-or-die-hint"
      });
    }

    if (!this.canGenerateThemes()) {
      section.createDiv({ text: this.getMissingGenerationConfigText(), cls: "write-or-die-empty" });
      return;
    }

    if (!hasCurrentThemes || !cache) {
      if (this.plugin.isGeneratingThemes) {
        return;
      }

      const empty = section.createDiv({ cls: "write-or-die-empty" });
      empty.createDiv({
        text: "选择练习类型，然后生成今天的练习。"
      });
      const generateButton = empty.createEl("button", { text: "现在生成", cls: "write-or-die-primary-button" });
      generateButton.disabled = this.plugin.isGeneratingThemes;
      generateButton.addEventListener("click", () => {
        void this.runThemeGeneration(generateButton);
      });
      return;
    }

    const themeList = section.createDiv({ cls: "write-or-die-theme-list" });
    for (const theme of cache.themes) {
      const card = themeList.createDiv({ cls: "write-or-die-theme-card" });
      card.createEl("h4", { text: theme.title });
      card.createEl("p", { text: theme.prompt });
      const createButton = card.createEl("button", { text: "开始写", cls: "write-or-die-primary-button" });
      createButton.addEventListener("click", () => {
        void this.plugin.createNoteFromTheme(theme);
      });
    }
  }

  private createMetric(container: Element, value: string, label: string): void {
    const metric = container.createDiv({ cls: "write-or-die-metric" });
    metric.createDiv({ text: value, cls: "write-or-die-metric-value" });
    metric.createDiv({ text: label, cls: "write-or-die-metric-label" });
  }

  private changeVisibleMonth(offset: number): void {
    const [, , selectedDayPart] = this.selectedDate.split("-");
    const selectedDay = Number(selectedDayPart) || 1;
    const target = new Date(this.visibleMonth.getFullYear(), this.visibleMonth.getMonth() + offset, 1);
    const daysInTargetMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    const nextSelectedDate = new Date(target.getFullYear(), target.getMonth(), Math.min(selectedDay, daysInTargetMonth));

    this.visibleMonth = new Date(target.getFullYear(), target.getMonth(), 1);
    this.selectedDate = getLocalDateKey(nextSelectedDate);
  }

  private formatSelectedDate(dateKey: string, today: string): string {
    const [, month, day] = dateKey.split("-");
    const label = `${Number(month)} 月 ${Number(day)} 日`;
    return dateKey === today ? `${label} · 今天` : label;
  }

  private canGenerateThemes(): boolean {
    if (this.plugin.settings.generationProvider === "vercel-proxy") {
      return this.plugin.settings.proxyEndpoint.trim().length > 0;
    }

    return this.plugin.settings.deepseekApiKey.trim().length > 0;
  }

  private getMissingGenerationConfigText(): string {
    if (this.plugin.settings.generationProvider === "vercel-proxy") {
      return "请在设置中填写 Vercel 代理地址，或切换为自填 DeepSeek Key。";
    }

    return "请在设置中填写 DeepSeek API Key。";
  }

  private async runThemeGeneration(button: HTMLButtonElement): Promise<void> {
    if (this.plugin.isGeneratingThemes) {
      new Notice("练习正在生成中。");
      return;
    }

    button.disabled = true;

    try {
      await this.plugin.generateThemes(true);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "练习生成失败。");
    } finally {
      button.disabled = false;
      await this.render();
    }
  }
}

class WriteOrDieSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: WriteOrDiePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("不写就会死").setHeading();

    new Setting(containerEl)
      .setName("练习生成方式")
      .setDesc("默认使用作者提供的 Vercel 代理；也可以切换为自填 DeepSeek Key。")
      .addDropdown((dropdown) => {
        for (const provider of GENERATION_PROVIDERS) {
          dropdown.addOption(provider, provider === "vercel-proxy" ? "官方免费额度（Vercel 代理）" : "自填 DeepSeek Key");
        }

        dropdown.setValue(this.plugin.settings.generationProvider).onChange(async (value) => {
          this.plugin.settings.generationProvider = normalizeGenerationProvider(value);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Vercel 代理地址")
      .setDesc("使用官方免费额度时调用的后端地址，例如 https://write-more-api.vercel.app/api/generate-themes。")
      .addText((text) =>
        text
          .setPlaceholder("https://your-project.vercel.app/api/generate-themes")
          .setValue(this.plugin.settings.proxyEndpoint)
          .onChange(async (value) => {
            this.plugin.settings.proxyEndpoint = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("DeepSeek API Key")
      .setDesc("选择自填 DeepSeek Key 时使用；保存在本地插件配置中。")
      .addText((text) => {
        text.inputEl.type = "password";
        text
          .setPlaceholder("DeepSeek API Key")
          .setValue(this.plugin.settings.deepseekApiKey)
          .onChange(async (value) => {
            this.plugin.settings.deepseekApiKey = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("写作文件目录")
      .setDesc("选中主题后，新文件会创建到这个目录。")
      .addText((text) =>
        text
          .setPlaceholder("写作主题")
          .setValue(this.plugin.settings.targetFolder)
          .onChange(async (value) => {
            this.plugin.settings.targetFolder = value.trim() || DEFAULT_SETTINGS.targetFolder;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("显示今日文件列表")
      .setDesc("关闭时，侧边栏只显示今日字数和新建文件数。")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showTodayFiles).onChange(async (value) => {
          this.plugin.settings.showTodayFiles = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("默认练习类型")
      .setDesc("侧边栏手动生成主题时使用这个类型。")
      .addDropdown((dropdown) => {
        for (const practiceType of PRACTICE_TYPES) {
          dropdown.addOption(practiceType, practiceType);
        }

        dropdown.setValue(this.plugin.settings.selectedPracticeType).onChange(async (value) => {
          this.plugin.settings.selectedPracticeType = normalizePracticeType(value);
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("每日主题数量")
      .addSlider((slider) =>
        slider
          .setLimits(1, 10, 1)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.themeCount)
          .onChange(async (value) => {
            this.plugin.settings.themeCount = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("DeepSeek 模型")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("deepseek-v4-flash", "deepseek-v4-flash")
          .addOption("deepseek-v4-pro", "deepseek-v4-pro")
          .setValue(this.plugin.settings.model)
          .onChange(async (value) => {
            this.plugin.settings.model = normalizeDeepSeekModel(value);
            await this.plugin.saveSettings();
          })
      );
  }
}
