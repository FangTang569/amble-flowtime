---
name: "amble: Timeflow Technique"
description: "一个极简的心流时间法践行工具"
---

# amble: Timeflow Technique
本应用致力于打磨正计时模式的体验，实践“心流时间法”。

## 特色

### 理念
休息不是工作的对立面，休息是工作的一部分。

### 功能
- 休息比例由自己设置，主推正计时模式，每次暂停会自动算出预计休息时间并预填入 ✅ (基础功能已完成)
- ~~休息比例由自己设置，主推正计时模式，每次暂停会自动算出预计休息时间并预填入（基础功能）~~
- 时间块视图，不与现实时间绑定，只是把你的工作和短休息可视化，让你能直观看出今日历程（灵感来自koreader的”全书漫游”）
- 高效的时间块添加系统（灵感来自toggl的time entry系统），方便用户快速添加未记录的时间块
- 零挫败感：
   - 统计最小粒度放大到周/月，日级视图放到深处

## 开发
本应用使用了Tauri框架和Tailwind CSS，致力于在跨平台的基础上时间较好的UI/UX和动效

## 进度
- [x] **Step 1**: 自动计算休息比例的计时器 (2026-07-20)
  - Tauri v2 + Vite + TypeScript + Tailwind CSS CDN 项目搭建
  - FlowTimer 状态机 (idle → running → paused → resting → idle)
  - Date.now() 差值计时，250ms tick
  - 暂停自动计算休息时间 (restTarget = workElapsed × ratio)
  - 比例滑块 5%–100%，默认 20%
  - 亮色主题，Inter 字体
- [x] Step 2: 本地记录存储 + 悬浮窗 + 数据库备份 (2026-07-20)
  - SQLite 持久化 (time_blocks 表，work/rest 分块)
  - 置顶悬浮小窗 (可拖拽、可开关)
  - 每日自动数据库备份 (保留 7 天)
  - Today 记录列表 + 总时长统计
- [x] Step 3: 时间块视图 (2026-07-20)
  - 水平分段条可视化今日 Focus/Break
  - 宽度按比例，不绑定现实时间
  - 首尾时间标签
- [x] Step 4: 快捷时间录入 (2026-07-20)
  - Focus/Break 类型选择 + 分钟输入 + Add 按钮
  - 手动补录标记 (is_manual=1)
  - 自动用当前比例计算 earned_rest_duration
- [x] Step 5: 统计与零挫败感 (2026-07-24)
  - 周/月/年统计 + 柱状图
  - 休息超时惩罚 / 超长时间滑块 — 已取消
- [x] Optimize: 离线可用 (2026-07-24)
  - Tailwind CSS CDN → CLI + PostCSS 本地构建
  - Google Fonts → @fontsource/inter Latin 子集本地托管
  - 生产构建完全离线可用
- [x] Optimize: 配色微调 & UI 打磨 (2026-07-25)
  - 纯白背景 → neutral-50 柔光色系
  - 文字/图标层级优化，Pause 改为图标按钮
  - 休息态 emerald-500 绿显（含悬浮窗）
  - 窗口默认 400×580
  - ratio 加 ≈ 约等号

## 体验优化 (进行中)

- [ ] **Step 6**: 统计视图左右切换日期 (2026-07-25)
  - 统计面板支持 ← → 翻页浏览历史日期
  - 周/月/年视图下的日期范围切换
- [x] Step 7: 设置页面 (2026-07-25)
  - 三段式胶囊切换 (Timer/Stats/Settings)
  - 默认比例持久化 (localStorage)
  - About / Tech 信息展示
- [x] Step 8: iOS 自用支持 (2026-07-25)
  - 平台守卫 (标题栏/窗口控制/悬浮窗仅桌面)
  - 安全区适配 + 触屏优化
  - GitHub Actions macOS 云端构建未签名 IPA
  - Sideloadly 自签安装流程