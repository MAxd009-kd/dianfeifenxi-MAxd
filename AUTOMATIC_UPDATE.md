# 自动更新说明

本发布包保留了网页中的增量合并和校验能力，并增加 GitHub Actions 月度计划：

- 每月5日检查国网分时电价、峰平谷时段和国网其他费用。
- 每月22日检查旬及以上基础价和带现货基础价。
- GitHub Actions 使用 UTC 时间，工作流按北京时间09:00换算为 UTC 01:00。

## 安全原则

- 只更新官网实际出现并通过校验的月份。
- 官网无法访问、需要登录/验证码、页面结构变化、字段不全或计算交叉校验失败时，不修改 `tou-data.js`。
- 自动任务不会删除旧月份。
- 自动任务生成 Pull Request，人工确认后再合并发布。
- 官方网站若限制云机房访问，可将同一工作流改由 GitHub self-hosted runner 运行，或者使用下述官方导出文件兜底流程。

## 官方导出文件兜底流程

### 市场价格（每月22日）

1. 从“分时价格浮动项历史参考值”导出 Excel。
2. 保存为 `official-input/market.xlsx`。
3. 运行 `npm run update:market`。

脚本读取：

- `（分时）年、月、旬中长期分时段加权出清电价` → 旬及以上基础价。
- `（分时）年、月、旬及实时现货加权出清电价` → 带现货基础价。

### 国网价格（每月5日）

将官网当月价表核对后的结构化内容保存为 `official-input/grid-update.json`，格式参考 `official-input/grid-update.example.json`，然后运行：

`npm run update:grid`

脚本会校验24小时时段、基础价、折价、尖峰/高峰/平段/低谷价格及四项国网其他费用，校验失败不会写入。

## 全自动官网抓取

`scripts/fetch-official-data.js` 是自动任务入口。它会优先查找以下来源：

1. 仓库变量 `MARKET_EXPORT_URL` / `GRID_EXPORT_URL` 指向的官方直接下载地址；
2. 官网页面中可直接识别的 `.xlsx/.xls/.pdf` 附件链接；
3. `official-input` 中人工导出的官方文件。

山西交易中心官网为动态页面，且可能限制 GitHub 云端IP、要求登录或验证码。遇到这些情况任务会安全退出并上传报告，不会伪造或猜测数据。可以在仓库 `Settings → Secrets and variables → Actions → Variables` 配置官方直接下载地址；不要提交账号、密码或Cookie到仓库。

详细业务规则仍以 [OFFICIAL_UPDATE.md](OFFICIAL_UPDATE.md) 为准。
