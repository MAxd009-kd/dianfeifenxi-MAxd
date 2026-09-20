(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TimeGridReport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const POLICY_SOURCE = "《关于开展2026年年度（含1月月度）山西电力零售交易的公告》（山西电力交易中心有限公司，公告〔2025〕222号，2025年12月9日）";

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function money(value) {
    return new Intl.NumberFormat("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(number(value));
  }

  function quantity(value, digits = 2) {
    return new Intl.NumberFormat("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(number(value));
  }

  function safeFileName(value) {
    return String(value || "电力用户").replace(/[\\/:*?"<>|]/g, "_").trim() || "电力用户";
  }

  function lineChart(values, options = {}) {
    const width = 760;
    const height = 220;
    const margin = { top: 24, right: 20, bottom: 38, left: 58 };
    const maximum = Math.max(...values, 1) * 1.08;
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const x = (index) => margin.left + (index / 23) * plotWidth;
    const y = (value) => margin.top + ((maximum - value) / maximum) * plotHeight;
    const path = values
      .map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
      .join(" ");
    const grid = Array.from({ length: 6 }, (_, index) => {
      const value = (maximum * index) / 5;
      const position = y(value);
      return `<line x1="${margin.left}" y1="${position}" x2="${width - margin.right}" y2="${position}" stroke="#dce6e0"/><text x="${margin.left - 8}" y="${position + 4}" text-anchor="end">${quantity(value, 1)}</text>`;
    }).join("");
    const labels = Array.from(
      { length: 24 },
      (_, index) => `<text x="${x(index)}" y="${height - 12}" text-anchor="middle">${index + 1}</text>`,
    ).join("");
    return `<svg class="report-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.label || "24小时曲线")}">${grid}<path d="${path}" fill="none" stroke="#176b50" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${labels}<text x="14" y="18">${escapeHtml(options.unit || "MWh")}</text></svg>`;
  }

  function comparisonBars(months) {
    const width = 760;
    const height = 250;
    const margin = { top: 30, right: 18, bottom: 48, left: 62 };
    const maximum = Math.max(...months.flatMap((month) => [month.gridCost, month.packageCost]), 1) * 1.12;
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const slot = plotWidth / months.length;
    const barWidth = Math.min(24, slot * 0.28);
    const y = (value) => margin.top + ((maximum - value) / maximum) * plotHeight;
    const bars = months.map((month, index) => {
      const center = margin.left + slot * (index + 0.5);
      const gridY = y(month.gridCost);
      const packageY = y(month.packageCost);
      return `<rect x="${center - barWidth - 2}" y="${gridY}" width="${barWidth}" height="${margin.top + plotHeight - gridY}" rx="2" fill="#7897c5"><title>${escapeHtml(month.month)} 国网 ${money(month.gridCost)}元</title></rect><rect x="${center + 2}" y="${packageY}" width="${barWidth}" height="${margin.top + plotHeight - packageY}" rx="2" fill="#2f7d5b"><title>${escapeHtml(month.month)} 坤电 ${money(month.packageCost)}元</title></rect><text x="${center}" y="${height - 18}" text-anchor="middle">${escapeHtml(month.month)}</text>`;
    }).join("");
    return `<svg class="report-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="逐月费用对比"><line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" stroke="#b8c8bf"/>${bars}<g transform="translate(${margin.left},12)"><rect width="13" height="13" rx="2" fill="#7897c5"/><text x="19" y="11">国网代理购电</text><rect x="112" width="13" height="13" rx="2" fill="#2f7d5b"/><text x="131" y="11">坤电方案</text></g></svg>`;
  }

  function buildSavingsReport(snapshot, options = {}) {
    const sellerName = options.sellerName || "坤电";
    const productName = options.productName || "时能智析 TimeGrid AI";
    const developer = options.developer || "MAxd-KD";
    const months = snapshot.months || [];
    if (!months.length) throw new Error("没有可生成报告的月份。");

    const totals = months.reduce((sum, month) => ({
      energy: sum.energy + number(month.totalEnergy),
      gridCost: sum.gridCost + number(month.gridCost),
      packageCost: sum.packageCost + number(month.packageCost),
      saving: sum.saving + number(month.saving),
    }), { energy: 0, gridCost: 0, packageCost: 0, saving: 0 });
    const savingRate = totals.gridCost ? (totals.saving / totals.gridCost) * 100 : 0;
    const unitSaving = totals.energy ? totals.saving / totals.energy : 0;
    const hourlyEnergy = Array(24).fill(0);
    const hourlySaving = Array(24).fill(0);
    months.forEach((month) => {
      month.energy.forEach((value, hourIndex) => {
        hourlyEnergy[hourIndex] += number(value);
        hourlySaving[hourIndex] += number(value)
          * (number(month.grid[hourIndex]) - number(month.packagePrices[hourIndex]));
      });
    });
    const topLoadHours = hourlyEnergy
      .map((value, index) => ({ hour: index + 1, value }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 3)
      .map((item) => `${item.hour}时`);
    const savingHours = hourlySaving
      .map((value, index) => ({ hour: index + 1, value }))
      .filter((item) => item.value > 0)
      .sort((left, right) => right.value - left.value)
      .slice(0, 3)
      .map((item) => `${item.hour}时`);
    const conclusion = totals.saving > 0
      ? `按现有${months.length}个月实际24小时用电分布测算，${sellerName}${snapshot.packageName}预计较国网代理购电节省${money(totals.saving)}元，降幅约${quantity(savingRate, 2)}%。`
      : totals.saving < 0
        ? `按当前参数测算，${sellerName}${snapshot.packageName}较国网代理购电增加${money(Math.abs(totals.saving))}元，建议调整套餐或统一加价后重新测算。`
        : "按当前参数测算，坤电方案与国网代理购电成本基本持平。";
    const benefitText = totals.saving > 0
      ? `本次结果表明，在用电结构和价格参数不变的前提下，企业选择${sellerName}并按本方案签约，预计可将市场化套餐选择空间转化为可量化的电费实惠；最终以正式合同和结算账单为准。`
      : "参与市场化零售的价值在于获得可比较、可协商的套餐选择；当前参数尚未形成成本优势，坤电可继续结合企业分时负荷优化套餐结构。";
    const monthRows = months.map((month) => `<tr><td>${escapeHtml(month.month)}</td><td>${quantity(month.totalEnergy, 2)}</td><td>${money(month.gridCost)}</td><td>${money(month.packageCost)}</td><td class="${month.saving >= 0 ? "positive" : "negative"}">${month.saving >= 0 ? "+" : "-"}${money(Math.abs(month.saving))}</td><td>${quantity(month.totalEnergy ? month.saving / month.totalEnergy : 0, 2)}</td></tr>`).join("");
    const generatedAt = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const statusClass = totals.saving > 0 ? "positive" : totals.saving < 0 ? "negative" : "neutral";
    const now = new Date();
    const localDateKey = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("");
    const reportNumber = `TG-${localDateKey}`;

    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(snapshot.company)}购电成本优化报告</title><style>
      :root{--green:#176b50;--dark:#17332a;--muted:#66766e;--line:#dbe5df;--soft:#f3f8f5;--gold:#a86a0c;--red:#b13f3f}*{box-sizing:border-box}body{margin:0;background:#e9efeb;color:var(--dark);font-family:"Microsoft YaHei","PingFang SC",Arial,sans-serif;line-height:1.65}.actions{position:sticky;top:0;z-index:3;display:flex;justify-content:center;gap:12px;padding:12px;background:rgba(23,51,42,.94)}button{border:0;border-radius:8px;padding:10px 18px;background:#fff;color:var(--dark);font-weight:700;cursor:pointer}.report{width:210mm;min-height:297mm;margin:18px auto;padding:17mm 16mm;background:#fff;box-shadow:0 12px 36px rgba(17,46,35,.13)}header{padding-bottom:18px;border-bottom:3px solid var(--green)}.brand{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.brand h1{margin:0;font-size:30px;letter-spacing:.04em}.brand small{color:var(--green);font-weight:700;letter-spacing:.12em}.seller{text-align:right}.seller strong{display:block;font-size:20px;color:var(--green)}.subtitle{margin:18px 0 0;font-size:20px;font-weight:700}.meta{display:flex;flex-wrap:wrap;gap:8px 24px;margin-top:7px;color:var(--muted);font-size:12px}.summary{margin:22px 0;padding:18px 20px;border-left:5px solid var(--green);background:var(--soft)}.summary strong{font-size:18px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:18px 0}.kpi{padding:14px;border:1px solid var(--line);border-radius:10px;background:#fff}.kpi span{display:block;color:var(--muted);font-size:12px}.kpi b{display:block;margin-top:5px;font-size:17px}.positive{color:var(--green)!important}.negative{color:var(--red)!important}.neutral{color:var(--gold)!important}section{margin-top:24px;break-inside:avoid}h2{margin:0 0 10px;padding-left:10px;border-left:4px solid var(--green);font-size:18px}h3{font-size:14px;margin:14px 0 5px}p{margin:7px 0}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:8px 7px;border:1px solid var(--line);text-align:right}th{background:var(--green);color:#fff}th:first-child,td:first-child{text-align:left}.report-chart{display:block;width:100%;height:auto;border:1px solid var(--line);border-radius:10px;background:#fff}.report-chart text{font-size:10px;fill:#617168}.insights{display:grid;grid-template-columns:1fr 1fr;gap:12px}.insight{padding:13px 15px;border-radius:9px;background:var(--soft)}ul{margin:8px 0;padding-left:22px}.policy{font-size:12px;color:#44574d}.disclaimer{padding:13px 15px;border:1px dashed #aebdb5;background:#fafcfb;color:#596a61;font-size:11px}.signature{display:flex;justify-content:space-between;align-items:flex-end;margin-top:28px;padding-top:15px;border-top:1px solid var(--line);color:var(--muted);font-size:11px}.signature strong{color:var(--green);font-size:15px}@page{size:A4;margin:10mm}@media print{body{background:#fff}.actions{display:none}.report{width:auto;min-height:auto;margin:0;padding:8mm;box-shadow:none}section{break-inside:avoid}}@media(max-width:820px){.report{width:100%;margin:0;padding:22px 16px}.kpis{grid-template-columns:repeat(2,1fr)}.insights{grid-template-columns:1fr}.brand{flex-direction:column}.seller{text-align:left}.actions{position:static}}
    </style></head><body><div class="actions"><button onclick="window.print()">打印／另存为PDF</button></div><main class="report"><header><div class="brand"><div><h1>时能智析</h1><small>TIMEGRID AI</small></div><div class="seller"><span>售电服务方案</span><strong>${escapeHtml(sellerName)}</strong></div></div><div class="subtitle">${escapeHtml(snapshot.company)}购电成本优化测算报告</div><div class="meta"><span>报告日期：${generatedAt}</span><span>测算期间：${months.map((item) => item.month).join("、")}</span><span>报告编号：${reportNumber}</span></div></header>
    <div class="summary ${statusClass}"><strong>${escapeHtml(conclusion)}</strong><p>${escapeHtml(benefitText)}</p></div>
    <div class="kpis"><div class="kpi"><span>纳入测算电量</span><b>${quantity(totals.energy, 2)} MWh</b></div><div class="kpi"><span>国网代理购电费用</span><b>${money(totals.gridCost)} 元</b></div><div class="kpi"><span>坤电方案费用</span><b>${money(totals.packageCost)} 元</b></div><div class="kpi"><span>预计节省／增加</span><b class="${statusClass}">${totals.saving >= 0 ? "节省" : "增加"} ${money(Math.abs(totals.saving))} 元</b></div></div>
    <section><h2>一、测算口径与坤电方案</h2><div class="insights"><div class="insight"><h3>方案参数</h3><p>套餐：${escapeHtml(snapshot.packageName)}</p><p>统一加价：${quantity(snapshot.markup, 3)} 元/MWh</p><p>纳入月份：${months.length}个月</p></div><div class="insight"><h3>计算口径</h3><p>按企业各月实际24小时用电分布逐小时计算。</p><p>国网费用=Σ小时电量×国网分时电价。</p><p>坤电费用=Σ小时电量×（套餐基础价＋统一加价）。</p></div></div></section>
    <section><h2>二、逐月购电成本对比</h2>${comparisonBars(months)}<table><thead><tr><th>月份</th><th>电量(MWh)</th><th>国网费用(元)</th><th>坤电费用(元)</th><th>节省/增加(元)</th><th>度电节省(元/MWh)</th></tr></thead><tbody>${monthRows}<tr><th>合计</th><th>${quantity(totals.energy, 2)}</th><th>${money(totals.gridCost)}</th><th>${money(totals.packageCost)}</th><th>${totals.saving >= 0 ? "+" : "-"}${money(Math.abs(totals.saving))}</th><th>${quantity(unitSaving, 2)}</th></tr></tbody></table></section>
    <section><h2>三、企业24小时用电特征</h2>${lineChart(hourlyEnergy, { unit: "MWh", label: "企业累计24小时用电曲线" })}<div class="insights"><div class="insight"><h3>主要用电时段</h3><p>累计用电量较高的时段集中在${topLoadHours.join("、")}，套餐比较应重点关注这些时段的价格差。</p></div><div class="insight"><h3>主要节省贡献时段</h3><p>${savingHours.length ? `${savingHours.join("、")}对本次节省贡献较大，坤电可在合同执行中持续跟踪相应价格变化。` : "当前参数下尚未形成明显的正向节省时段，建议进一步调整套餐或统一加价。"}</p></div></div></section>
    <section><h2>四、政策背景与签约价值</h2><div class="policy"><p>依据${POLICY_SOURCE}：</p><ul><li>具备省内电力交易资格的电力用户，以及经山西电力批发市场准入的售电公司，可以参与零售交易。</li><li>除电气化铁路牵引用户外，市场化零售用户需签订分时零售套餐；售电公司可按标的周期创建套餐，零售用户按需要选择。</li><li>2026年零售套餐电价参数采用“价格值＋价差值”，公告明确价差值上下限为±20元/MWh。</li><li>同一标的周期内，零售用户原则上只与一家售电公司建立零售服务关系。</li></ul><p>政策为用户提供了市场化套餐选择空间。坤电通过企业分时用电分析、套餐参数测算和月度跟踪，将方案由“统一报价”转变为“基于实际负荷的可验证报价”，帮助企业在签约前看清成本差异，在履约中持续复盘。</p></div></section>
    <section><h2>五、坤电服务建议</h2><ul><li>以企业真实24小时负荷为依据确定套餐，不只比较单一平均价格。</li><li>围绕主要用电时段复核套餐基础价和统一加价，优先锁定可持续的成本优势。</li><li>每月对比实际账单与测算结果，遇到负荷结构变化时及时调整下一周期策略。</li><li>签约前明确套餐周期、价格参数、解约条款、偏差责任及其他合同边界。</li></ul></section>
    <section><h2>六、重要说明</h2><div class="disclaimer">本报告基于用户导入数据和工具内当前电价数据形成模拟测算，不构成保本、固定收益或最终结算承诺。报告仅比较可比的分时电量电价部分；容（需）量电费、国网其他费用、税费、偏差考核、绿电绿证、合同约定及政策调整等，应以正式零售合同、交易平台结果和国网结算账单为准。签约前应核对最新政策、套餐参数及企业实际用电计划。</div></section>
    <div class="signature"><div><strong>${escapeHtml(sellerName)}售电服务</strong><br>让套餐选择建立在真实用电数据之上</div><div>由 ${escapeHtml(productName)} 生成<br>开发作者 ${escapeHtml(developer)}</div></div></main></body></html>`;
  }

  function downloadSavingsReport(snapshot, options = {}) {
    const html = buildSavingsReport(snapshot, options);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${safeFileName(snapshot.company)}_坤电购电成本优化报告.html`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { POLICY_SOURCE, buildSavingsReport, downloadSavingsReport };
});
