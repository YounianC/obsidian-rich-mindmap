import {
  getLanguage,
  PluginSettingTab,
  Setting,
  type App,
} from "obsidian";
import { t, type LanguageSetting } from "./i18n";
import type MindmapPlugin from "./main";

export interface MindmapSettings {
  /** 带 `mindmap: true` 的文件是否自动用思维导图视图打开 */
  autoOpen: boolean;
  /** 界面语言；"auto" 表示跟随 Obsidian 的语言设置 */
  language: LanguageSetting;
}

export const DEFAULT_SETTINGS: MindmapSettings = {
  autoOpen: true,
  language: "auto",
};

/** 语言下拉的三个选项。「跟随 Obsidian」括注当前检测到的语言码，
 *  让用户看得出跟随的结果是什么。 */
function languageOptions(): Record<string, string> {
  return {
    auto: `${t("settings.language.auto")}（${getLanguage()}）`,
    zh: t("settings.language.zh"),
    en: t("settings.language.en"),
  };
}

export class MindmapSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MindmapPlugin) {
    super(app, plugin);
  }

  /**
   * 设置页刻意只有 `display()` 这一条路径。
   *
   * Obsidian 1.13 引入了声明式设置（`getSettingDefinitions()`），好处是设置项能
   * 被设置面板的搜索索引到，`display()` 也随之标记为 deprecated。但它没有
   * `onChange`：唯一能观察到「用户改了哪个设置」的钩子是基类的
   * `setControlValue()`，刷新页面自身文案还要调 `update()`——两个都是
   * `@since 1.13.0`。而本插件的 `minAppVersion` 是 1.8.7，官方的
   * `obsidianmd/no-unsupported-api` 体检把这两处调用报成 **Error**（不是警告），
   * 即使它们只在 1.13+ 上才可能被基类调到——那条规则是静态扫描的。
   *
   * 两条出路只能选一条：抬 `minAppVersion` 到 1.13.0，或者放弃声明式。选了后者，
   * 代价只是两个设置项进不了搜索索引；抬版本的代价是 1.13 以下的用户直接装不了。
   * `obsidian.d.ts` 对 `display()` 的原话也是「Only implement display() as a
   * fallback for plugins that need to support Obsidian versions older than
   * 1.13.0」——所以那条 deprecated 提示是预期内的，不是要修的东西。
   *
   * **不要「顺手」把声明式加回来**，那会让官方体检重新报 Error。真要加，得连
   * `minAppVersion` 与 `versions.json` 一起抬到 1.13.0，那是产品决策不是重构。
   */
  override display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl)
      .setName(t("settings.language.name"))
      .setDesc(t("settings.language.desc"))
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(languageOptions())) {
          dropdown.addOption(value, label);
        }
        dropdown
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            // addDropdown 的回调给的是 string，收窄到 LanguageSetting
            this.plugin.settings.language =
              value === "zh" || value === "en" ? value : "auto";
            await this.plugin.saveSettings();
            this.plugin.applyLanguage();
            // t() 自己不通知任何人，已渲染的标签要靠这次重画才会换语言。
            this.display();
          });
      });

    new Setting(this.containerEl)
      .setName(t("settings.autoOpen.name"))
      .setDesc(t("settings.autoOpen.desc"))
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoOpen).onChange(async (value) => {
          this.plugin.settings.autoOpen = value;
          await this.plugin.saveSettings();
        }),
      );
  }
}
