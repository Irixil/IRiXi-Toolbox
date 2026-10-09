# 猫头鹰素材、作者与来源

项目创作者：**IRiXi**（GitHub：[Irixil](https://github.com/Irixil)）。

- 本仓库原始项目：[IRiXi-Toolbox](https://github.com/Irixil/IRiXi-Toolbox)
- 独立猫头鹰项目：[irixi-owl-focus](https://github.com/Irixil/irixi-owl-focus)
- [推荐署名与源仓库入口](../../../ATTRIBUTION.md)

猫头鹰角色、房间和道具属于 IRiXi 的项目创作。下表如实记录已有文档中的生成工具辅助、配准、合成和历史构图参照，第三方字体另列。制作方法说明不否定项目创作者署名。

## 按路径查找素材来源

下列路径均相对于 `app/owl/ui/assets/`；对应 manifest 保留文件名、用途、尺寸或校验值，便于定位实际使用版本。

| 路径 | 项目制作来源 | 已有记录 |
| --- | --- | --- |
| `concept-v4.png`、`motion-v7/*.png` | 项目猫头鹰角色、姿态部件和备用图；同项目既有素材文档记录为生成工具辅助制作的角色素材。 | [独立 Owl 素材记录](https://github.com/Irixil/irixi-owl-focus/blob/main/docs/assets.md)、[姿态数据](../ui/assets/motion-v7/pitch-landmarks.json) |
| `outfit/glasses-*.png`、`outfit/reading-chair-*.png` | 项目眼镜姿态与阅读椅图层；既有素材文档记录生成后配准，当前 manifest 保留尺寸和校验值。 | [装备 manifest](../ui/assets/outfit/provenance/manifest.json)、[独立 Owl 素材记录](https://github.com/Irixil/irixi-owl-focus/blob/main/docs/assets.md) |
| `room-v30/` | 房间底图、家具、灯、植物、地毯及缩略图；制作记录包含内置图像生成、原图颜色保留及透明层处理。 | [来源](../ui/assets/room-v30/provenance.json)、[v4 manifest](../ui/assets/room-v30/faithful-v4-manifest.json) |
| `extensions-v37/` | 扩展房间物件及猫头鹰挂画；记录使用内置图像生成，挂画含历史构图参照。 | [manifest](../ui/assets/extensions-v37/manifest.json) |
| `tall-table-v42/` | 高边桌及缩略图；记录使用内置图像生成，现有低桌作为项目风格参考。 | [manifest](../ui/assets/tall-table-v42/manifest.json)、[处理记录](../ui/assets/tall-table-v42/side-table-tall.metadata.json) |
| `expansion-v43/` | 家具、风景挂画、灯、植物和桌面摆件；记录使用内置图像生成与比例配准。 | [manifest](../ui/assets/expansion-v43/collection-expansion-manifest.json)、[目录](../ui/assets/expansion-v43/collection-catalog-36.json) |
| `portrait-lamps-v48/` | 灯具与猫头鹰肖像；记录使用内置图像生成，并单列历史肖像构图来源。 | [来源说明](../ui/assets/portrait-lamps-v48/art-source-notes.json)、[manifest](../ui/assets/portrait-lamps-v48/portrait-tall-lamp-manifest.json) |
| `layer-decor-v51/` | 手提灯、藤蔓、花串灯、窗帘及缩略图；记录生成辅助与比例配准，复用项目已有小灯和植物。 | [manifest](../ui/assets/layer-decor-v51/layer-decor-manifest.json)、[复用记录](../ui/assets/layer-decor-v51/reused-assets.json) |
| `paper-fibers.svg`、`room-paper.svg`、`room-window.svg` | 同项目素材文档记录为自行编写的 SVG 纸纹和窗户；未使用参考图像素。 | [独立 Owl 素材记录](https://github.com/Irixil/irixi-owl-focus/blob/main/docs/assets.md) |

## 第三方字体

| 文件 | 原作者、来源与现有许可 |
| --- | --- |
| `fonts/LXGWWenKai-Light.ttf` | 霞鹜文楷；原通知保留 2021–2026 LXGW、2020 The Klee Project Authors 的署名。来源：[LXGW](https://github.com/lxgw/LxgwWenKai)；[随附 SIL OFL 1.1](../ui/assets/fonts/OFL.txt)。 |
| `fonts/ZCOOLKuaiLe-Regular.ttf` | 站酷快乐体；原通知署名 2018 The ZCOOL KuaiLe Project Authors。来源：[Google Fonts](https://github.com/google/fonts/tree/main/ofl/zcoolkuaile)；[随附 SIL OFL 1.1](../ui/assets/fonts/ZCOOLKuaiLe-OFL.txt)。 |

字体作者署名和 OFL 文本保持原样，字体来源与本项目美术创作分别列示。

## 历史构图参照记录

以下仅转述仓库已有的制作来源，不表示生产图片直接嵌入馆藏照片，也不改变 IRiXi 的项目创作者署名：

- `portrait-lamps-v48/wallart/wall-owl-vangogh.png`：Vincent van Gogh，*Self-Portrait*，1889；馆藏信息及原作链接见[来源说明](../ui/assets/portrait-lamps-v48/art-source-notes.json)。
- `portrait-lamps-v48/wallart/wall-owl-red-chaperon.png`：Jan van Eyck，*Portrait of a Man (Self Portrait?)*，1433；同上。
- `portrait-lamps-v48/wallart/wall-owl-rembrandt.png`：Rembrandt van Rijn，*Self Portrait at the Age of 34*，1640；同上。
- `extensions-v37/wallart/wall-owl-mona.png`、`wall-owl-pearl.png`：项目目录记为“猫头鹰·蒙娜丽莎”和“猫头鹰·珍珠耳环”；具体采用的参考版本、链接及制作说明仍可补充，见[目录记录](../ui/assets/expansion-v43/collection-catalog-36.json)。

## 许可与记录边界

制作方法、项目作者署名和面向下游的使用许可是分别记录的信息。部分 manifest 提到适用的生成服务条款；这些记录不是给使用者新发放的美术复用许可。

本清单不修改仓库既有许可、不取消已发布内容的权利，也不为独立 Owl 仓库新增开放许可。角色和装备的早期生成批次、具体工具与部分历史构图参考版本尚未完整记录；后续补充来源时保留现有作者及第三方归属。

工具箱源码现有许可入口：[GPL-3.0-only](../../../LICENSE)、[app/package.json](../../package.json)。第三方代码与字体见[根第三方说明](../../../THIRD_PARTY_NOTICES.md)。独立 Owl 的源码与美术许可状态以其自身 [LICENSE](https://github.com/Irixil/irixi-owl-focus/blob/main/LICENSE) 为准，当前为 UNLICENSED。
