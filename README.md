# IRiXi Toolbox

IRiXi Toolbox（IRiXi 的小工具库）是一个置于 macOS 屏幕顶部的个人工具库。它把灵动岛式工作台、Snaploom 截图与标注、本机 OCR/图片翻译、输入翻译、跨应用划词和英文朗读放在同一个应用里。

> 当前是源码预览版。区域截图和单一权限身份已在开发者的 Mac 上实测；全部标注、OCR/翻译输出、窗口和全屏截图仍在持续验收。本仓库暂不提供可直接下载的签名安装包。

## 主要功能

- 区域、窗口和全屏截图
- Snaploom 原生标注、复制、保存和钉图
- Apple Vision 本机识字与图片翻译
- 中英/中日/中韩输入翻译、跨应用划词和英文朗读
- 待办、笔记、录音、番茄钟和可选剪贴板历史
- 屏幕录制权限只由 `com.irixi.toolbox` 主程序申请，不再运行独立截图权限助手

## 目录

```text
IRiXi-Toolbox/
├── app/       # Electron 灵动岛主程序
├── snaploom/  # GPLv3 原生截图与翻译源码
└── scripts/   # 一键组装脚本
```

## 本地构建

需要：

- macOS 15 或更高版本
- Xcode 26 或更高版本
- Node.js 22.12 或更高版本

```bash
./scripts/prepare.sh
cd app
npm test
npm run pack
```

`prepare.sh` 会从本仓库的 `snaploom/` 构建原生框架，再将它安全放入主程序的打包目录。开发构建使用临时签名；正式分发需要发布者自己的 Apple Developer ID。

## 权限和隐私

截图需要 macOS 的“屏幕与系统音频录制”权限；跨应用划词可选使用“辅助功能”权限。截图、OCR 和 Apple 本机翻译默认在本机处理。应用不包含共享 API 密钥。

## 来源与许可证

本项目使用 [GNU GPL v3](LICENSE)。主程序由 MIT 许可的 TO-DO Panel 演进而来；原生截图部分基于 GPLv3 的 Snaploom/macshot。原作者版权与许可声明均保留，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

IRiXi Toolbox 是独立修改版，与上游项目不存在官方隶属或背书关系。
