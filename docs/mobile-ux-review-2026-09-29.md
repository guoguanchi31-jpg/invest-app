# App 端视觉与交互审查

日期：2026-09-29。基于当前工作区源码，不代表已发布安装包。

使用 Playwright Chromium、触屏与手机 viewport 检查 375×667、393×852、412×915，补充 852×393 横屏和 375×367 短可视区。页面覆盖总览、账本、账户、投资、预算、目标及录入弹窗。所有接口使用模拟数据，没有修改真实账目或业务代码。

这是移动 Web 渲染与交互验证；尚未在 iOS/Android 原生安装包中验证系统键盘、返回手势、刘海安全区和文件导出。短可视区测试不能替代系统键盘测试。

## 已复现的问题

### 1. P1：顶部月份确认抛异常，弹窗不能正常关闭

- 复现：点击顶部月份 → 选择 8 月 → 点击「确认选择」。正常模拟网络下也可复现。
- 实际：顶部月份已变为 2026 年 8 月，但月份弹窗仍存在；控制台报 `setSelectedIncomeCategory is not defined`。用户需要另点关闭，容易以为操作没有成功。
- 原因：[App.jsx](/Users/bytedance/Desktop/invest-app/frontend/src/App.jsx:1117) 的确认逻辑调用已不存在的 `setSelectedIncomeCategory`、`setSelectedExpenseCategory`，中断后续关闭逻辑。
- 建议：删除失效调用或接入实际存在的筛选状态；一次确认应完成月份切换和关闭。
- 验收：所有一级页面正常切月，弹窗关闭、无异常、内容与所选月份一致。
- [弹窗未关闭截图](/Users/bytedance/Desktop/invest-app/docs/mobile-ux-review-2026-09-29/16-stale-month.png)。截图同时注入了接口失败；运行时异常另在正常响应下独立复现。

### 2. P1：月份请求失败后，新月份下面仍显示旧月份金额

- 复现：先加载 9 月数据 → 将 8 月总览接口模拟为 503 → 切到 8 月 → 手动关闭上述未关闭的月份弹窗。
- 实际：月份显示 8 月，收入、支出、结余仍保留 9 月数值。页面虽然有失败提示，但金额没有过期标识，也没有就近重试入口。
- 原因：[useFinanceData.js](/Users/bytedance/Desktop/invest-app/frontend/src/app/useFinanceData.js:126) 请求失败时保留此前数据；[当前数据判断](/Users/bytedance/Desktop/invest-app/frontend/src/app/useFinanceData.js:229) 只关联身份，没有关联月份和趋势范围。
- 建议：数据绑定完整查询条件。失败时显示当前月份的错误占位和重试；如保留旧值，明确标注旧值所属月份，避免当作新月份数据呈现。
- 验收：弱网、失败、快速切月时，不出现新月份标题搭配未标识的旧月份金额。
- [截图](/Users/bytedance/Desktop/invest-app/docs/mobile-ux-review-2026-09-29/17-stale-month-uncovered.png)。

### 3. P2：悬浮「＋」覆盖流水编辑按钮，点击会进入新建

- 复现条件：393×852，总览使用一条最近交易及空趋势数据。在首屏点击最近交易右下的编辑按钮位置。
- 实际：编辑按钮位于 x=326、y≈729，大小 34×34；其中心点实际命中悬浮「记一笔」，打开的是新建弹窗。
- 原因：[index.css](/Users/bytedance/Desktop/invest-app/frontend/src/index.css:5550) 将 52×52 的入口固定在页面右下，而滚动内容的行操作也在右侧。只增加页面底部 padding 不能消除滚动过程中的遮挡。
- 建议：把全局记账入口纳入底部导航的独立操作区，或调整内容及操作布局，使其不会与悬浮入口重叠。账本已有「记一笔」，可去掉该页重复的悬浮入口。
- 验收：不同滚动位置、375/393/412 宽度下，编辑按钮中心点都命中编辑，不会打开新建。
- [截图](/Users/bytedance/Desktop/invest-app/docs/mobile-ux-review-2026-09-29/14-fab-overlap.png)。

### 4. P2：交易金额被取整，用户无法从流水核对分角

- 复现：接口返回午餐支出 19.90，首页最近交易和账本都显示 `−¥20`。
- 原因：[App.jsx](/Users/bytedance/Desktop/invest-app/frontend/src/App.jsx:163) 的共享 `formatMoney` 对所有金额使用 `Math.round`。
- 影响：交易列表与录入值不一致；例如小于 0.50 的流水会显示为 0。这里确认的是展示精度问题，未发现据此改写存储金额。
- 建议：流水、账户详情、编辑核对及分配差额保留两位小数。总览可采用单独的紧凑金额格式，且明确单位。
- 验收：0.01、19.90、12345.67 等数据在核对场景保留精度。
- [账本截图](/Users/bytedance/Desktop/invest-app/docs/mobile-ux-review-2026-09-29/18-pixel-ledger.png)。

### 5. P2：误触弹窗外部后，未保存内容丢失

- 复现：打开「记一笔」 → 输入 19.90 → 点击遮罩 → 再打开「记一笔」。
- 实际：遮罩直接关闭弹窗，再次打开金额为空，没有草稿恢复或放弃修改提示。
- 原因：[ModalBackdrop.jsx](/Users/bytedance/Desktop/invest-app/frontend/src/components/ModalBackdrop.jsx:44) 直接关闭；[App.jsx](/Users/bytedance/Desktop/invest-app/frontend/src/App.jsx:853) 每次打开都重建表单。
- 建议：有改动时保留临时草稿，或在关闭时确认放弃；手机录入弹窗可禁用有内容时的遮罩关闭。避免用户只是想收起键盘却丢失输入。
- 验收：有输入后误触遮罩不丢内容；明确选择放弃才清除。

### 6. P2：切换底部导航后，账本搜索条件丢失

- 复现：账本输入搜索「午餐」 → 进入资产，等待账户卡片出现 → 返回账本。
- 实际：搜索框恢复为空。账本搜索和部分筛选状态在页面组件内，页面卸载后重建。
- 位置：[LedgerPage.jsx](/Users/bytedance/Desktop/invest-app/frontend/src/pages/LedgerPage.jsx:77)、[App.jsx](/Users/bytedance/Desktop/invest-app/frontend/src/App.jsx:2459)。
- 建议：在一级 Tab 之间保留搜索、筛选、分页和滚动位置；切换家庭/个人身份时再按产品规则重置。
- 验收：从筛选结果去查账户后返回，仍能接着查看原来的结果。

### 7. P2：手机总览预算信息粘连

- 复现：手机总览向下滚到「本月预算」。
- 实际：底部读成「已用 62%剩余 ¥7,654」，缺少间隔和左右对齐。
- 原因：`.budget-footer` 的 `display:flex`、`justify-content:space-between`、上间距仅存在于 `min-width:521px` 的规则内。手机实测计算样式是 `display:block`。
- 位置：[index.css](/Users/bytedance/Desktop/invest-app/frontend/src/index.css:4574)、[DashboardPage.jsx](/Users/bytedance/Desktop/invest-app/frontend/src/pages/DashboardPage.jsx:143)。
- 建议：把预算底部的基础布局移到公共样式，小屏允许换行并保留 gap。
- 验收：左右文字间距清晰，窄屏和大金额下可自然换行。
- [截图](/Users/bytedance/Desktop/invest-app/docs/mobile-ux-review-2026-09-29/15-budget-footer.png)。

### 8. P2：弹窗未约束键盘焦点，焦点可进入遮罩后的页面

- 复现：打开记账弹窗，从金额输入框连续按 Tab，经过「取消」后继续。
- 实际：焦点进入后台「近12月」「近6月」「查看全部」等控件。
- 原因：[ModalPanel.jsx](/Users/bytedance/Desktop/invest-app/frontend/src/components/ModalPanel.jsx:25) 虽声明 `aria-modal`，但没有焦点循环、背景 inert 或关闭后焦点恢复。
- 建议：补齐对话框焦点管理。该项对外接键盘和辅助操作用户更重要；尚未以 VoiceOver/TalkBack 实机验证。
- 验收：Tab/Shift+Tab 始终在最上层弹窗内，关闭后回到触发按钮，背景不能被键盘操作。

## 视觉与流程建议

1. **保留现有墨绿、米白、金色体系，先改善信息层级。** 手机顶部已有面包屑、32px 标题、家庭/个人与月份；账本再叠二级 Tab、工具栏和汇总，流水要到屏幕较下方才出现。建议缩短顶栏，压缩低频入口，让前几笔流水更早进入首屏。
2. **提升可读性和触控尺寸。** 实测图表周期按钮高约 31px、编辑按钮 34×34、部分文字按钮高 30px。建议常用操作热区至少做到 44×44 左右，图标可保持小尺寸。目标日期和说明有 9–10px 字号，建议关键辅助信息使用 12–14px，并提升灰字对比度。
3. **空状态要告诉用户下一步。** 空目标时首页只剩「目标进度」标题和「全部」。投资页没有投资账户时，长空图表占据前排，录入/买入按钮又禁用。建议优先展示「创建投资账户 → 录入持仓」入口，空趋势压缩为一行提示；首页空目标直接给「创建目标」。[投资空状态截图](/Users/bytedance/Desktop/invest-app/docs/mobile-ux-review-2026-09-29/06-investments.png)。
4. **目标日期统一为日期选择器。** [目标表单](/Users/bytedance/Desktop/invest-app/frontend/src/components/PlanSetupDialog.jsx:481) 使用文本输入且指定 `inputMode="numeric"`，却要求 `2027-12-31`。建议复用已有日期选择交互，避免手输格式；数字键盘是否能输入连字符须实机核实。[截图](/Users/bytedance/Desktop/invest-app/docs/mobile-ux-review-2026-09-29/09-goal-form.png)。
5. **记账和复杂规划采用不同密度。** 记账可突出金额、收入/支出切换、常用分类和近期账户；家庭目标的总额、月计划、成员分配则适合分段填写。保存成功用轻量反馈，校验错误就近显示，避免频繁系统 alert。
6. **原生专项补测。** 检查系统返回优先关闭最上层弹窗、键盘弹出后金额与提交按钮可达、文件导出能在系统分享或文件界面获取、横屏与大字号。这些是待测项，不作为已确认 Bug。

## 修复顺序

先修月份确认异常、跨月份旧数据展示、悬浮入口遮挡及金额精度；然后补草稿保护、Tab 状态保留和弹窗焦点；最后统一字体、触控尺寸、空状态及视觉间距。

本次常规模拟数据检查未见手机整页横向溢出；短可视区内弹窗头尾仍可见，内容区可滚动。没有执行完整后端测试或真实原生设备测试。
