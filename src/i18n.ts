/**
 * 界面文字的中英双语字典与取值入口。
 *
 * **本模块刻意不 `import obsidian`。** `getLanguage()` 只在 `main.ts` 一处
 * 调用，结果作为参数传进 `resolveLocale`——这样字典与解析逻辑可以直接单测，
 * 不需要 mock Obsidian。
 *
 * **但它也不放进 `src/model/`。** `t()` 读下面那个模块级的 `current`，同样的
 * 入参在 `setLocale()` 前后返回不同结果，它不是纯函数。`check-purity.mjs` 只
 * 校验四条禁令（import obsidian / document / window / HTMLElement），一个字典
 * 加一个可变变量能通过校验，但放进纯函数层是在骗人：那一层的契约是纯粹性，
 * 不是「碰巧没碰 DOM」。
 */

export type Locale = "zh" | "en";
export type LanguageSetting = "auto" | "zh" | "en";

export const LOCALES: readonly Locale[] = ["zh", "en"] as const;

/**
 * 中文表同时充当 key 的唯一来源：`MessageKey` 由它推导，英文表声明为
 * `Record<MessageKey, string>`，于是漏一条英文翻译是编译错误，调用处拼错 key
 * 也是编译错误。
 *
 * `{name}` 是插值占位符，由 `t()` 替换。
 */
const zh = {
  // 命令面板
  "command.toggleView": "切换思维导图 / 源码视图",
  "command.markAsMindmap": "标记为思维导图（写入 frontmatter）",
  "command.openSourcePane": "并排打开源码面板",

  // 文件右键菜单
  "menu.newMindmap": "新建思维导图",
  "menu.openAsMindmap": "以思维导图打开",

  // 通知
  "notice.createFailed": "新建思维导图失败：{error}",
  "notice.marked": "已标记为思维导图。",
  "notice.toggleFailed": "切换视图失败：{error}",
  "notice.externalChange": "文件已在外部修改，以磁盘内容为准。",

  // 设置
  "settings.autoOpen.name": "自动以思维导图打开",
  "settings.autoOpen.desc":
    "文件 frontmatter 含 mindmap: true 时，打开即进入思维导图视图。",
  "settings.language.name": "界面语言",
  "settings.language.desc": "插件界面文字使用的语言。切换后立即生效。",
  "settings.language.auto": "跟随 Obsidian",
  // 语言名按惯例始终用它自己的语言书写，两张表里的值相同
  "settings.language.zh": "简体中文",
  "settings.language.en": "English",
  "settings.defaultZoom.name": "打开导图时的缩放",
  "settings.defaultZoom.desc":
    "内容较多时「适应窗口」会缩到很小，选 100% 可以直接从根节点开始按原始大小阅读。只影响之后新打开的视图。",
  "settings.defaultZoom.fit": "适应窗口",
  "settings.defaultZoom.actual": "100%（原始大小）",

  // 视图
  "view.switchToSource": "切换到源码模式",
  "view.openSourcePane": "并排打开源码",
  "view.displayTitle": "思维导图",
  "view.untitledFile": "未命名.md",
  "view.error.title": "无法解析为思维导图",
  "view.error.hint": "文件未被修改。可切到源码模式检查内容。",
  "view.link.placeholder": "链接目标（笔记名）",

  // 缩放控件
  "controls.fit": "适应窗口",
  "controls.zoomOut": "缩小",
  "controls.zoomIn": "放大",
  // 百分比读数本身就是这个按钮，文案同时充当它的 tooltip 与无障碍名
  "controls.actualSize": "恢复 100%（原始大小）",

  // 标记面板的分区标题
  "marks.priority": "优先级",
  "marks.progress": "进度",
  "marks.flag": "旗帜",

  // 角标的无障碍标签，node-el.ts 与 marks-panel.ts 共用
  "badge.priority": "优先级 {priority}",
  "badge.progress": "进度 {progress}%",
  "badge.flag": "旗帜 {flag}",
  "badge.note": "备注",
  "badge.collapsed": "已折叠 {count} 个子节点，点击展开",

  // 工具栏
  "toolbar.style.bold": "加粗",
  "toolbar.style.italic": "斜体",
  "toolbar.style.strike": "删除线",
  "toolbar.addChild": "添加子节点",
  "toolbar.addSibling": "添加兄弟节点",
  "toolbar.addSibling.blockedRoot": "根节点没有兄弟节点",
  "toolbar.remove": "删除节点",
  "toolbar.remove.blockedHidden":
    "该节点携带图上不可见的正文（标题下的散文、表格、代码块等），删除会连带丢掉这些内容",
  "toolbar.remove.blockedRoot": "根节点不能删除",
  "toolbar.textStyle": "文字样式",
  "toolbar.marks": "标记",
  "toolbar.marks.blockedRoot": "根节点不能带标记：文件里没有一级标题时无处写回",
  "toolbar.note": "备注",
  "toolbar.note.blockedRoot": "根节点不能带备注：文件里没有一级标题时无处写回",
  "note.placeholder": "写点备注……",
  "note.hint": "Cmd/Ctrl + Enter 保存，Esc 取消",
  "toolbar.link": "插入链接",
  "toolbar.collapse": "折叠子树",
  "toolbar.collapse.blocked": "没有子节点可折叠",

  // 新建文件的默认基名。它会落到磁盘上成为文件名与文件里的 H1，
  // 只影响新建，已有文件不改名不重写。
  "newFile.basename": "未命名思维导图",
} as const;

export type MessageKey = keyof typeof zh;

const en: Record<MessageKey, string> = {
  "command.toggleView": "Toggle mindmap / source view",
  "command.markAsMindmap": "Mark as mindmap (write frontmatter)",
  "command.openSourcePane": "Open source pane side by side",

  "menu.newMindmap": "New mindmap",
  "menu.openAsMindmap": "Open as mindmap",

  "notice.createFailed": "Could not create the mindmap: {error}",
  "notice.marked": "Marked as a mindmap.",
  "notice.toggleFailed": "Could not switch the view: {error}",
  "notice.externalChange": "The file changed externally; the copy on disk wins.",

  "settings.autoOpen.name": "Open as mindmap automatically",
  "settings.autoOpen.desc":
    "When a file's frontmatter contains mindmap: true, open it directly in mindmap view.",
  "settings.language.name": "Interface language",
  "settings.language.desc":
    "Language used for this plugin's interface. Takes effect immediately.",
  "settings.language.auto": "Follow Obsidian",
  "settings.language.zh": "简体中文",
  "settings.language.en": "English",
  "settings.defaultZoom.name": "Zoom when opening a mindmap",
  "settings.defaultZoom.desc":
    "Fitting a large mindmap to the window makes it tiny. Pick 100% to start reading from the root node at actual size. Only affects views opened from now on.",
  "settings.defaultZoom.fit": "Fit to window",
  "settings.defaultZoom.actual": "100% (actual size)",

  "view.switchToSource": "Switch to source mode",
  "view.openSourcePane": "Open source side by side",
  "view.displayTitle": "Mindmap",
  "view.untitledFile": "Untitled.md",
  "view.error.title": "Cannot read this file as a mindmap",
  "view.error.hint": "The file was not modified. Switch to source mode to inspect it.",
  "view.link.placeholder": "Link target (note name)",

  "controls.fit": "Fit to window",
  "controls.zoomOut": "Zoom out",
  "controls.zoomIn": "Zoom in",
  "controls.actualSize": "Reset to 100% (actual size)",

  "marks.priority": "Priority",
  "marks.progress": "Progress",
  "marks.flag": "Flag",

  "badge.priority": "Priority {priority}",
  "badge.progress": "Progress {progress}%",
  "badge.flag": "Flag {flag}",
  "badge.note": "Note",
  "badge.collapsed": "{count} child nodes collapsed — click to expand",

  "toolbar.style.bold": "Bold",
  "toolbar.style.italic": "Italic",
  "toolbar.style.strike": "Strikethrough",
  "toolbar.addChild": "Add child node",
  "toolbar.addSibling": "Add sibling node",
  "toolbar.addSibling.blockedRoot": "The root node has no siblings",
  "toolbar.remove": "Delete node",
  "toolbar.remove.blockedHidden":
    "This node carries body text that the map does not show (prose, tables and code blocks under a heading); deleting it would take that content with it",
  "toolbar.remove.blockedRoot": "The root node cannot be deleted",
  "toolbar.textStyle": "Text style",
  "toolbar.marks": "Marks",
  "toolbar.marks.blockedRoot":
    "The root node cannot carry marks: with no level-1 heading in the file there is nowhere to write them",
  "toolbar.note": "Note",
  "toolbar.note.blockedRoot":
    "The root node can't carry a note: there's nowhere to write it back when the file has no level-1 heading",
  "note.placeholder": "Write a note…",
  "note.hint": "Cmd/Ctrl + Enter to save, Esc to cancel",
  "toolbar.link": "Insert link",
  "toolbar.collapse": "Collapse subtree",
  "toolbar.collapse.blocked": "No child nodes to collapse",

  "newFile.basename": "Untitled Mindmap",
};

/** 供测试遍历两张表；生产代码请用 `t()`，不要直接读它。 */
export const MESSAGES: Record<Locale, Record<MessageKey, string>> = { zh, en };

/** 纯函数：设置值 + Obsidian 的语言码 → 实际语言。 */
export function resolveLocale(
  setting: LanguageSetting,
  appLanguage: string,
): Locale {
  if (setting !== "auto") return setting;
  // Obsidian 的 getLanguage() 返回 ISO 码，中文可能是 zh / zh-TW / zh-HK。
  // 只有简体一套表，繁体归到简体（README 的已知局限里写明了这一点）。
  return appLanguage.startsWith("zh") ? "zh" : "en";
}

/** 模块级当前语言。默认中文，与改造前的行为一致。 */
let current: Locale = "zh";

/**
 * 切换当前语言。
 *
 * **`t()` 自己不通知任何人。** 已经渲染出去的 DOM 不会因为这次调用而更新——
 * 语言变更后必须由 `main.ts` 的 `applyLanguage()` 显式重注册命令并让各导图
 * 视图重建图层。这是本方案唯一的真实陷阱。
 */
export function setLocale(locale: Locale): void {
  current = locale;
}

/**
 * 取当前语言下 key 对应的文案，并替换 `{name}` 占位符。
 *
 * 参数缺失时保留 `{name}` 字面量而不抛异常：面向用户的文案出问题不该让渲染
 * 管线崩掉，留着占位符至少能让人看出是哪条文案缺参数。
 */
export function t(
  key: MessageKey,
  params?: Record<string, string | number>,
): string {
  const template = MESSAGES[current][key];
  if (params === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}
