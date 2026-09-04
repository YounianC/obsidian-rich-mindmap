import {
  getLanguage,
  PluginSettingTab,
  Setting,
  type App,
  type SettingDefinitionItem,
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
   * Obsidian ≥ 1.13 的声明式设置：能被设置面板的搜索索引到，读写由基类直接落到
   * `plugin.settings` 并持久化。定义非空时基类不会再调用下面的 display()。
   */
  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: t("settings.language.name"),
        desc: t("settings.language.desc"),
        control: {
          type: "dropdown",
          key: "language",
          defaultValue: DEFAULT_SETTINGS.language,
          options: languageOptions(),
        },
      },
      {
        name: t("settings.autoOpen.name"),
        desc: t("settings.autoOpen.desc"),
        control: {
          type: "toggle",
          key: "autoOpen",
          defaultValue: DEFAULT_SETTINGS.autoOpen,
        },
      },
    ];
  }

  /**
   * 声明式设置的写入入口。`SettingControlBase` 没有 `onChange`，这里是唯一能
   * 观察到「用户改了哪个设置」的地方（基类注释：Mutates and persists
   * `this.plugin.settings`）。
   *
   * 先让基类落盘，再对语言做两件事：`applyLanguage()` 重设语言、重注册命令、
   * 让各导图视图重建图层；`update()` 重渲染设置页自身，否则页面上的标签还
   * 留在旧语言。
   */
  override async setControlValue(key: string, value: unknown): Promise<void> {
    await super.setControlValue(key, value);
    if (key !== "language") return;
    this.plugin.applyLanguage();
    this.update();
  }

  /** 1.13 之前的版本没有声明式 API，基类回退到这里手工渲染；内容要和上面保持一致。 */
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
