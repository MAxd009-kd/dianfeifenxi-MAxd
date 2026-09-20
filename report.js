(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TimeGridReport = api;
})(typeof window !== "undefined" ? window : typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PRODUCT_NAME = "时能智析";
  const PRODUCT_NAME_EN = "TimeGrid AI";
  const DEVELOPER = "MAxd-KD";
  const COLORS = {
    green: "#176b50", dark: "#17332a", muted: "#66766e", line: "#dbe5df",
    soft: "#f3f8f5", blue: "#7897c5", red: "#b13f3f", white: "#ffffff",
  };

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function money(value) {
    return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number(value));
  }

  function quantity(value, digits = 2) {
    return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(number(value));
  }

  function safeFileName(value) {
    return String(value || "电力用户").replace(/[\\/:*?\"<>|]/g, "_").trim() || "电力用户";
  }

  function localDateParts() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return { display: `${year}/${month}/${day}`, key: `${year}${month}${day}` };
  }

  function makeReportModel(snapshot) {
    const months = Array.isArray(snapshot.months) ? snapshot.months : [];
    if (!months.length) throw new Error("没有可生成报告的月份。");
    const totals = months.reduce((sum, month) => ({
      energy: sum.energy + number(month.totalEnergy),
      gridCost: sum.gridCost + number(month.gridCost),
      packageCost: sum.packageCost + number(month.packageCost),
      saving: sum.saving + number(month.saving),
    }), { energy: 0, gridCost: 0, packageCost: 0, saving: 0 });
    const savingRate = totals.gridCost ? totals.saving / totals.gridCost * 100 : 0;
    const unitSaving = totals.energy ? totals.saving / totals.energy : 0;
    const hourlyEnergy = Array(24).fill(0);
    months.forEach((month) => (month.energy || []).forEach((value, hourIndex) => {
      if (hourIndex < 24) hourlyEnergy[hourIndex] += number(value);
    }));
    const topLoadHours = hourlyEnergy.map((value, index) => ({ hour: index + 1, value }))
      .sort((left, right) => right.value - left.value).slice(0, 3).map((item) => `${item.hour}时`);
    const conclusion = totals.saving > 0
      ? `按现有${months.length}个月实际24小时用电分布测算，当前${snapshot.packageName}预计较国网代理购电节省${money(totals.saving)}元，降幅约${quantity(savingRate, 2)}%。`
      : totals.saving < 0
        ? `按当前参数测算，当前${snapshot.packageName}较国网代理购电增加${money(Math.abs(totals.saving))}元，建议调整套餐或统一加价后重新测算。`
        : "按当前参数测算，当前售电方案与国网代理购电成本基本持平。";
    const benefitText = totals.saving > 0
      ? "在用电结构和价格参数不变的前提下，签约市场化售电方案预计可获得上述电费实惠；最终以正式合同、交易结果和结算账单为准。"
      : "市场化售电方案的价值在于获得可比较、可协商的套餐选择；当前参数尚未形成成本优势，可继续结合企业分时负荷优化方案。";
    return { snapshot, months, totals, savingRate, unitSaving, hourlyEnergy, topLoadHours, conclusion, benefitText, date: localDateParts() };
  }

  function buildSavingsReport(snapshot) {
    const model = makeReportModel(snapshot);
    const monthRows = model.months.map((month) => `<tr><td>${escapeHtml(month.month)}</td><td>${quantity(month.totalEnergy, 2)}</td><td>${money(month.gridCost)}</td><td>${money(month.packageCost)}</td><td>${month.saving >= 0 ? "+" : "-"}${money(Math.abs(month.saving))}</td></tr>`).join("");
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(snapshot.company)}购电成本测算报告</title></head><body><main><h1>${PRODUCT_NAME}</h1><p>${PRODUCT_NAME_EN}</p><h2>${escapeHtml(snapshot.company)}购电成本测算报告</h2><p>${escapeHtml(model.conclusion)}</p><p>${escapeHtml(model.benefitText)}</p><h2>一、测算口径与当前方案</h2><p>套餐：${escapeHtml(snapshot.packageName)}；统一加价：${quantity(snapshot.markup, 3)}元/MWh。</p><h2>二、逐月购电成本对比</h2><table><tbody>${monthRows}</tbody></table><h2>三、企业24小时用电特征</h2><p>累计用电量较高的时段集中在${model.topLoadHours.join("、")}。</p><h2>四、时能智析建议</h2><ul><li>以企业真实24小时负荷为依据确定套餐，不只比较单一平均价格。</li><li>签约前明确套餐周期、价格参数、解约条款、偏差责任及其他合同边界。</li></ul><h2>五、重要说明</h2><p>本报告为模拟测算，最终以正式合同、交易结果和结算账单为准。</p><h2>附表A 企业24小时分时电量</h2><p>时段为行、月份为列，月份较多时在PDF中自动分页。</p><h2>附表B 当前套餐与国网24小时价格差</h2><p>差值=国网分时电价－当前套餐价格；正值表示当前套餐价格更低。</p></main></body></html>`;
  }

  function chunkItems(items, size) {
    const chunks = [];
    for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
    return chunks;
  }

  function getReportPageCount(snapshot) {
    const monthCount = Array.isArray(snapshot.months) ? snapshot.months.length : 0;
    return 3 + Math.ceil(monthCount / 4) + Math.ceil(monthCount / 2);
  }

  function roundedRect(ctx, x, y, width, height, radius, fill, stroke) {
    ctx.beginPath(); ctx.roundRect(x, y, width, height, radius);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function setFont(ctx, size, weight = 400) {
    ctx.font = `${weight} ${size}px "Microsoft YaHei", "PingFang SC", Arial, sans-serif`;
  }

  function wrapLines(ctx, text, maxWidth) {
    const lines = []; let line = "";
    for (const character of String(text || "")) {
      const test = line + character;
      if (line && ctx.measureText(test).width > maxWidth) { lines.push(line); line = character; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, options = {}) {
    setFont(ctx, options.size || 24, options.weight || 400);
    ctx.fillStyle = options.color || COLORS.dark; ctx.textAlign = options.align || "left"; ctx.textBaseline = "top";
    const lines = wrapLines(ctx, text, maxWidth);
    lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
    return y + lines.length * lineHeight;
  }

  function createPage() {
    const canvas = document.createElement("canvas"); canvas.width = 1240; canvas.height = 1754;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = COLORS.white; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.lineJoin = "round"; ctx.lineCap = "round";
    return { canvas, ctx };
  }

  function drawPageHeader(ctx, title) {
    ctx.fillStyle = COLORS.green; ctx.fillRect(0, 0, 1240, 18);
    setFont(ctx, 34, 700); ctx.fillStyle = COLORS.dark; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(PRODUCT_NAME, 88, 58);
    setFont(ctx, 15, 700); ctx.fillStyle = COLORS.green; ctx.fillText(PRODUCT_NAME_EN.toUpperCase(), 90, 104);
    setFont(ctx, 22, 700); ctx.fillStyle = COLORS.dark; ctx.textAlign = "right"; ctx.fillText(title, 1152, 72);
    ctx.strokeStyle = COLORS.line; ctx.beginPath(); ctx.moveTo(88, 142); ctx.lineTo(1152, 142); ctx.stroke();
  }

  function drawPageFooter(ctx, pageNumber, totalPages) {
    ctx.strokeStyle = COLORS.line; ctx.beginPath(); ctx.moveTo(88, 1664); ctx.lineTo(1152, 1664); ctx.stroke();
    setFont(ctx, 15); ctx.fillStyle = COLORS.muted; ctx.textAlign = "left"; ctx.fillText(`${PRODUCT_NAME} ${PRODUCT_NAME_EN} · 开发作者 ${DEVELOPER}`, 88, 1684);
    ctx.textAlign = "right"; ctx.fillText(`第 ${pageNumber} / ${totalPages} 页`, 1152, 1684);
  }

  function drawSectionTitle(ctx, text, y) {
    ctx.fillStyle = COLORS.green; ctx.fillRect(88, y + 2, 7, 36);
    setFont(ctx, 27, 700); ctx.fillStyle = COLORS.dark; ctx.textAlign = "left"; ctx.textBaseline = "top"; ctx.fillText(text, 112, y);
    return y + 56;
  }

  function drawKpi(ctx, x, y, width, label, value, valueColor = COLORS.dark) {
    roundedRect(ctx, x, y, width, 138, 14, COLORS.white, COLORS.line);
    setFont(ctx, 18); ctx.fillStyle = COLORS.muted; ctx.textAlign = "left"; ctx.fillText(label, x + 20, y + 22);
    setFont(ctx, 25, 700); ctx.fillStyle = valueColor; ctx.fillText(value, x + 20, y + 67);
  }

  function renderSummaryPage(model, totalPages) {
    const { ctx, canvas } = createPage(); drawPageHeader(ctx, "购电成本测算报告"); let y = 190;
    setFont(ctx, 34, 700); ctx.fillStyle = COLORS.dark; ctx.textAlign = "left"; ctx.fillText(`${model.snapshot.company}购电成本测算报告`, 88, y); y += 62;
    setFont(ctx, 17); ctx.fillStyle = COLORS.muted; ctx.fillText(`报告日期：${model.date.display}`, 88, y); ctx.fillText(`测算期间：${model.months.map((item) => item.month).join("、")}`, 335, y); ctx.fillText(`报告编号：TG-${model.date.key}`, 830, y); y += 62;
    roundedRect(ctx, 88, y, 1064, 210, 16, COLORS.soft); ctx.fillStyle = COLORS.green; ctx.fillRect(88, y, 7, 210);
    const textY = drawWrappedText(ctx, model.conclusion, 120, y + 28, 990, 42, { size: 27, weight: 700, color: model.totals.saving >= 0 ? COLORS.green : COLORS.red });
    drawWrappedText(ctx, model.benefitText, 120, textY + 15, 990, 31, { size: 19 }); y += 240;
    drawKpi(ctx, 88, y, 254, "纳入测算电量", `${quantity(model.totals.energy, 2)} MWh`); drawKpi(ctx, 358, y, 254, "国网代理购电费用", `${money(model.totals.gridCost)} 元`); drawKpi(ctx, 628, y, 254, "当前方案费用", `${money(model.totals.packageCost)} 元`); drawKpi(ctx, 898, y, 254, "预计节省／增加", `${model.totals.saving >= 0 ? "节省" : "增加"} ${money(Math.abs(model.totals.saving))} 元`, model.totals.saving >= 0 ? COLORS.green : COLORS.red); y += 180;
    y = drawSectionTitle(ctx, "一、测算口径与当前方案", y); roundedRect(ctx, 88, y, 516, 330, 14, COLORS.soft); roundedRect(ctx, 636, y, 516, 330, 14, COLORS.soft);
    setFont(ctx, 22, 700); ctx.fillStyle = COLORS.dark; ctx.fillText("方案参数", 116, y + 25); ctx.fillText("计算口径", 664, y + 25);
    [`套餐：${model.snapshot.packageName}`, `统一加价：${quantity(model.snapshot.markup, 3)} 元/MWh`, `纳入月份：${model.months.length}个月`].forEach((line, index) => drawWrappedText(ctx, line, 116, y + 82 + index * 65, 460, 30, { size: 20 }));
    let rightY = y + 82; ["按企业各月实际24小时用电分布逐小时计算。", "国网费用=Σ小时电量×国网分时电价。", "当前方案费用=Σ小时电量×（套餐基础价＋统一加价）。"].forEach((line) => { rightY = drawWrappedText(ctx, line, 664, rightY, 450, 30, { size: 19 }) + 28; });
    drawWrappedText(ctx, "说明：本报告只比较可比的分时电量电价部分，其他费用及合同约定见报告末页的重要说明。", 88, y + 370, 1064, 31, { size: 18, color: COLORS.muted }); drawPageFooter(ctx, 1, totalPages); return canvas;
  }

  function drawComparisonChart(ctx, months, x, y, width, height) {
    const maximum = Math.max(...months.flatMap((month) => [number(month.gridCost), number(month.packageCost)]), 1) * 1.12;
    const plot = { x: x + 80, y: y + 48, width: width - 110, height: height - 105 };
    ctx.strokeStyle = COLORS.line;
    for (let step = 0; step <= 4; step += 1) { const lineY = plot.y + plot.height * step / 4; ctx.beginPath(); ctx.moveTo(plot.x, lineY); ctx.lineTo(plot.x + plot.width, lineY); ctx.stroke(); setFont(ctx, 14); ctx.fillStyle = COLORS.muted; ctx.textAlign = "right"; ctx.fillText(quantity(maximum * (1 - step / 4), 0), plot.x - 12, lineY - 8); }
    const slot = plot.width / months.length; const barWidth = Math.min(30, slot * 0.28);
    months.forEach((month, index) => { const center = plot.x + slot * (index + 0.5); const gridHeight = number(month.gridCost) / maximum * plot.height; const planHeight = number(month.packageCost) / maximum * plot.height; ctx.fillStyle = COLORS.blue; ctx.fillRect(center - barWidth - 3, plot.y + plot.height - gridHeight, barWidth, gridHeight); ctx.fillStyle = COLORS.green; ctx.fillRect(center + 3, plot.y + plot.height - planHeight, barWidth, planHeight); setFont(ctx, 14); ctx.fillStyle = COLORS.muted; ctx.textAlign = "center"; ctx.fillText(month.month, center, plot.y + plot.height + 18); });
    ctx.fillStyle = COLORS.blue; ctx.fillRect(plot.x, y + 12, 16, 16); ctx.fillStyle = COLORS.green; ctx.fillRect(plot.x + 180, y + 12, 16, 16); setFont(ctx, 15); ctx.fillStyle = COLORS.dark; ctx.textAlign = "left"; ctx.fillText("国网代理购电", plot.x + 24, y + 9); ctx.fillText("当前方案", plot.x + 204, y + 9);
  }

  function drawTable(ctx, columns, rows, x, y, widths, rowHeight) {
    let cursorX = x;
    columns.forEach((column, index) => { ctx.fillStyle = COLORS.green; ctx.fillRect(cursorX, y, widths[index], rowHeight); setFont(ctx, 15, 700); ctx.fillStyle = COLORS.white; ctx.textAlign = index === 0 ? "left" : "right"; ctx.textBaseline = "middle"; ctx.fillText(column, index === 0 ? cursorX + 12 : cursorX + widths[index] - 12, y + rowHeight / 2); cursorX += widths[index]; });
    rows.forEach((row, rowIndex) => { cursorX = x; const rowY = y + rowHeight * (rowIndex + 1); const isTotal = rowIndex === rows.length - 1; row.forEach((value, index) => { ctx.fillStyle = isTotal ? "#e7f2ec" : rowIndex % 2 ? COLORS.soft : COLORS.white; ctx.fillRect(cursorX, rowY, widths[index], rowHeight); ctx.strokeStyle = COLORS.line; ctx.strokeRect(cursorX, rowY, widths[index], rowHeight); setFont(ctx, 15, isTotal ? 700 : 400); ctx.fillStyle = index === 4 && String(value).startsWith("+") ? COLORS.green : COLORS.dark; ctx.textAlign = index === 0 ? "left" : "right"; ctx.textBaseline = "middle"; ctx.fillText(String(value), index === 0 ? cursorX + 12 : cursorX + widths[index] - 12, rowY + rowHeight / 2); cursorX += widths[index]; }); });
  }

  function renderComparisonPage(model, totalPages) {
    const { ctx, canvas } = createPage(); drawPageHeader(ctx, "逐月购电成本对比"); let y = drawSectionTitle(ctx, "二、逐月购电成本对比", 190);
    roundedRect(ctx, 88, y, 1064, 390, 14, COLORS.white, COLORS.line); drawComparisonChart(ctx, model.months, 98, y + 10, 1044, 370); y += 430;
    const rows = model.months.map((month) => [month.month, quantity(month.totalEnergy, 2), money(month.gridCost), money(month.packageCost), `${month.saving >= 0 ? "+" : "-"}${money(Math.abs(month.saving))}`, quantity(month.totalEnergy ? month.saving / month.totalEnergy : 0, 2)]);
    rows.push(["合计", quantity(model.totals.energy, 2), money(model.totals.gridCost), money(model.totals.packageCost), `${model.totals.saving >= 0 ? "+" : "-"}${money(Math.abs(model.totals.saving))}`, quantity(model.unitSaving, 2)]);
    const rowHeight = Math.min(58, Math.max(43, Math.floor(760 / (rows.length + 1)))); drawTable(ctx, ["月份", "电量(MWh)", "国网费用(元)", "当前方案费用(元)", "节省/增加(元)", "度电节省"], rows, 88, y, [115, 150, 190, 205, 190, 160], rowHeight);
    drawWrappedText(ctx, `测算结论：${model.conclusion}`, 88, y + rowHeight * (rows.length + 1) + 28, 1064, 33, { size: 20, weight: 700, color: model.totals.saving >= 0 ? COLORS.green : COLORS.red }); drawPageFooter(ctx, 2, totalPages); return canvas;
  }

  function drawHourlyCurve(ctx, values, x, y, width, height) {
    const maximum = Math.max(...values, 1) * 1.08; const plot = { x: x + 72, y: y + 35, width: width - 96, height: height - 88 }; ctx.strokeStyle = COLORS.line;
    for (let step = 0; step <= 4; step += 1) { const lineY = plot.y + plot.height * step / 4; ctx.beginPath(); ctx.moveTo(plot.x, lineY); ctx.lineTo(plot.x + plot.width, lineY); ctx.stroke(); setFont(ctx, 14); ctx.fillStyle = COLORS.muted; ctx.textAlign = "right"; ctx.fillText(quantity(maximum * (1 - step / 4), 1), plot.x - 10, lineY - 8); }
    ctx.strokeStyle = COLORS.green; ctx.lineWidth = 4; ctx.beginPath(); values.forEach((value, index) => { const px = plot.x + plot.width * index / 23; const py = plot.y + plot.height * (1 - number(value) / maximum); if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); }); ctx.stroke();
    values.forEach((value, index) => { const px = plot.x + plot.width * index / 23; const py = plot.y + plot.height * (1 - number(value) / maximum); ctx.fillStyle = COLORS.green; ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill(); setFont(ctx, 13); ctx.fillStyle = COLORS.muted; ctx.textAlign = "center"; ctx.fillText(String(index + 1), px, plot.y + plot.height + 22); }); setFont(ctx, 14); ctx.fillStyle = COLORS.muted; ctx.textAlign = "left"; ctx.fillText("MWh", x + 8, y + 5);
  }

  function renderInsightPage(model, totalPages) {
    const { ctx, canvas } = createPage(); drawPageHeader(ctx, "用电特征与测算说明"); let y = drawSectionTitle(ctx, "三、企业24小时用电特征", 190);
    roundedRect(ctx, 88, y, 1064, 430, 14, COLORS.white, COLORS.line); drawHourlyCurve(ctx, model.hourlyEnergy, 98, y + 12, 1044, 405); y += 468;
    roundedRect(ctx, 88, y, 1064, 132, 14, COLORS.soft); setFont(ctx, 21, 700); ctx.fillStyle = COLORS.dark; ctx.textAlign = "left"; ctx.fillText("主要用电时段", 116, y + 24); drawWrappedText(ctx, `累计用电量较高的时段集中在${model.topLoadHours.join("、")}，套餐比较应重点关注这些时段的价格差。`, 116, y + 65, 1000, 31, { size: 19 }); y += 174;
    y = drawSectionTitle(ctx, "四、时能智析建议", y); ["以企业真实24小时负荷为依据确定套餐，不只比较单一平均价格。", "签约前明确套餐周期、价格参数、解约条款、偏差责任及其他合同边界。"].forEach((text, index) => { roundedRect(ctx, 88, y + index * 112, 1064, 88, 12, COLORS.soft); ctx.fillStyle = COLORS.green; ctx.beginPath(); ctx.arc(120, y + 44 + index * 112, 7, 0, Math.PI * 2); ctx.fill(); drawWrappedText(ctx, text, 145, y + 25 + index * 112, 965, 31, { size: 20 }); }); y += 260;
    y = drawSectionTitle(ctx, "五、重要说明", y); roundedRect(ctx, 88, y, 1064, 260, 14, "#fafcfb", COLORS.line); drawWrappedText(ctx, "本报告基于用户导入数据和工具内当前电价数据形成模拟测算，不构成保本、固定收益或最终结算承诺。报告仅比较可比的分时电量电价部分；容（需）量电费、国网其他费用、税费、偏差考核、绿电绿证、合同约定及政策调整等，应以正式零售合同、交易平台结果和国网结算账单为准。签约前应核对最新套餐参数及企业实际用电计划。", 116, y + 28, 1008, 34, { size: 19, color: COLORS.muted }); drawPageFooter(ctx, 3, totalPages); return canvas;
  }

  function drawMatrixTable(ctx, columns, rows, x, y, widths, rowHeight, options = {}) {
    let cursorX = x;
    columns.forEach((column, index) => {
      ctx.fillStyle = COLORS.green;
      ctx.fillRect(cursorX, y, widths[index], rowHeight);
      setFont(ctx, options.headerSize || 17, 700);
      ctx.fillStyle = COLORS.white;
      ctx.textAlign = index === 0 ? "left" : "right";
      ctx.textBaseline = "middle";
      ctx.fillText(column, index === 0 ? cursorX + 12 : cursorX + widths[index] - 12, y + rowHeight / 2);
      cursorX += widths[index];
    });
    rows.forEach((row, rowIndex) => {
      cursorX = x;
      const rowY = y + rowHeight * (rowIndex + 1);
      const isTotal = Boolean(options.totalRow && rowIndex === rows.length - 1);
      row.forEach((value, index) => {
        ctx.fillStyle = isTotal ? "#e7f2ec" : rowIndex % 2 ? COLORS.soft : COLORS.white;
        ctx.fillRect(cursorX, rowY, widths[index], rowHeight);
        ctx.strokeStyle = COLORS.line;
        ctx.strokeRect(cursorX, rowY, widths[index], rowHeight);
        setFont(ctx, options.bodySize || 16, isTotal ? 700 : 400);
        ctx.fillStyle = options.colorForCell ? options.colorForCell(value, index, rowIndex) : COLORS.dark;
        ctx.textAlign = index === 0 ? "left" : "right";
        ctx.textBaseline = "middle";
        ctx.fillText(String(value), index === 0 ? cursorX + 12 : cursorX + widths[index] - 12, rowY + rowHeight / 2);
        cursorX += widths[index];
      });
    });
  }

  function renderEnergyDataPage(model, monthChunk, chunkIndex, chunkTotal, pageNumber, totalPages) {
    const { ctx, canvas } = createPage();
    drawPageHeader(ctx, "企业24小时分时电量");
    let y = drawSectionTitle(ctx, `附表A 企业24小时分时电量（${chunkIndex + 1}/${chunkTotal}）`, 190);
    drawWrappedText(ctx, `企业：${model.snapshot.company}　单位：MWh　展示月份：${monthChunk.map((month) => month.month).join("、")}`, 88, y, 1064, 30, { size: 18, color: COLORS.muted });
    y += 52;
    const monthWidth = Math.floor((1064 - 118 - 180) / monthChunk.length);
    const widths = [118, ...monthChunk.map(() => monthWidth)];
    widths.push(1064 - widths.reduce((sum, width) => sum + width, 0));
    const rows = Array.from({ length: 24 }, (_, hourIndex) => [
      `${String(hourIndex + 1).padStart(2, "0")}时`,
      ...monthChunk.map((month) => quantity(month.energy[hourIndex], 2)),
      quantity(monthChunk.reduce((sum, month) => sum + number(month.energy[hourIndex]), 0), 2),
    ]);
    rows.push([
      "月合计",
      ...monthChunk.map((month) => quantity(month.totalEnergy, 2)),
      quantity(monthChunk.reduce((sum, month) => sum + number(month.totalEnergy), 0), 2),
    ]);
    drawMatrixTable(ctx, ["时段", ...monthChunk.map((month) => month.month), "小时合计"], rows, 88, y, widths, 50, { totalRow: true, headerSize: 17, bodySize: 16 });
    drawWrappedText(ctx, "注：该附表采用“时段为行、月份为列”的形式；月份超过4个时自动续页，避免缩小字体影响阅读。", 88, y + 1335, 1064, 29, { size: 17, color: COLORS.muted });
    drawPageFooter(ctx, pageNumber, totalPages);
    return canvas;
  }

  function drawPriceMonthTable(ctx, month, x, y, width) {
    roundedRect(ctx, x, y, width, 1270, 14, COLORS.white, COLORS.line);
    setFont(ctx, 23, 700);
    ctx.fillStyle = COLORS.dark;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(month.month, x + 18, y + 18);
    setFont(ctx, 14, 400);
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = "right";
    ctx.fillText("单位：元/MWh", x + width - 18, y + 24);
    const tableX = x + 14;
    const tableY = y + 60;
    const innerWidth = width - 28;
    const widths = [70, 132, 132, innerWidth - 334];
    const rows = Array.from({ length: 24 }, (_, hourIndex) => {
      const gridPrice = number(month.grid[hourIndex]);
      const packagePrice = number(month.packagePrices[hourIndex]);
      const difference = gridPrice - packagePrice;
      return [
        String(hourIndex + 1),
        quantity(gridPrice, 2),
        quantity(packagePrice, 2),
        `${difference > 0 ? "+" : ""}${quantity(difference, 2)}`,
      ];
    });
    drawMatrixTable(ctx, ["时", "国网", "当前套餐", "差值"], rows, tableX, tableY, widths, 46, {
      headerSize: 14,
      bodySize: 13,
      colorForCell: (value, columnIndex) => columnIndex === 3
        ? String(value).startsWith("+") ? COLORS.green : number(value) < 0 ? COLORS.red : COLORS.dark
        : COLORS.dark,
    });
  }

  function renderPriceDifferencePage(model, monthChunk, chunkIndex, chunkTotal, pageNumber, totalPages) {
    const { ctx, canvas } = createPage();
    drawPageHeader(ctx, "当前套餐与国网24小时价格差");
    let y = drawSectionTitle(ctx, `附表B 当前套餐与国网24小时价格差（${chunkIndex + 1}/${chunkTotal}）`, 190);
    drawWrappedText(ctx, "差值=国网分时电价－当前套餐价格；正值表示当前套餐价格更低，负值表示国网代理购电价格更低。", 88, y, 1064, 30, { size: 18, color: COLORS.muted });
    y += 62;
    if (monthChunk.length === 1) {
      drawPriceMonthTable(ctx, monthChunk[0], 348, y, 544);
    } else {
      drawPriceMonthTable(ctx, monthChunk[0], 88, y, 520);
      drawPriceMonthTable(ctx, monthChunk[1], 632, y, 520);
    }
    drawPageFooter(ctx, pageNumber, totalPages);
    return canvas;
  }

  function dataUrlBytes(dataUrl) {
    const binary = atob(dataUrl.split(",")[1]); const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function concatBytes(parts) {
    const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0;
    parts.forEach((part) => { result.set(part, offset); offset += part.length; }); return result;
  }

  function ascii(text) { return new TextEncoder().encode(text); }

  function buildPdfFromCanvases(canvases) {
    const pageWidth = 595.28; const pageHeight = 841.89; const objects = []; const pageIds = []; let nextId = 3;
    const images = canvases.map((canvas, index) => { const imageId = nextId++; const contentId = nextId++; const pageId = nextId++; pageIds.push(pageId); return { name: `Im${index + 1}`, bytes: dataUrlBytes(canvas.toDataURL("image/jpeg", 0.94)), width: canvas.width, height: canvas.height, imageId, contentId, pageId }; });
    objects[1] = ascii("<< /Type /Catalog /Pages 2 0 R >>"); objects[2] = ascii(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
    images.forEach((image) => { objects[image.imageId] = concatBytes([ascii(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`), image.bytes, ascii("\nendstream")]); const content = ascii(`q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/${image.name} Do\nQ\n`); objects[image.contentId] = concatBytes([ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii("endstream")]); objects[image.pageId] = ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /${image.name} ${image.imageId} 0 R >> >> /Contents ${image.contentId} 0 R >>`); });
    const parts = [new Uint8Array([37,80,68,70,45,49,46,52,10,37,226,227,207,211,10])]; const offsets = [0]; let byteLength = parts[0].length;
    for (let id = 1; id < objects.length; id += 1) { offsets[id] = byteLength; const objectBytes = concatBytes([ascii(`${id} 0 obj\n`), objects[id], ascii("\nendobj\n")]); parts.push(objectBytes); byteLength += objectBytes.length; }
    const xrefOffset = byteLength; let xref = `xref\n0 ${objects.length}\n0000000000 65535 f \n`; for (let id = 1; id < objects.length; id += 1) xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`; xref += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`; parts.push(ascii(xref)); return new Blob(parts, { type: "application/pdf" });
  }

  function buildSavingsPdf(snapshot) {
    if (typeof document === "undefined") throw new Error("PDF只能在浏览器中生成。");
    const model = makeReportModel(snapshot);
    const energyChunks = chunkItems(model.months, 4);
    const priceChunks = chunkItems(model.months, 2);
    const totalPages = 3 + energyChunks.length + priceChunks.length;
    const canvases = [
      renderSummaryPage(model, totalPages),
      renderComparisonPage(model, totalPages),
      renderInsightPage(model, totalPages),
    ];
    energyChunks.forEach((monthChunk, chunkIndex) => {
      canvases.push(renderEnergyDataPage(model, monthChunk, chunkIndex, energyChunks.length, canvases.length + 1, totalPages));
    });
    priceChunks.forEach((monthChunk, chunkIndex) => {
      canvases.push(renderPriceDifferencePage(model, monthChunk, chunkIndex, priceChunks.length, canvases.length + 1, totalPages));
    });
    return buildPdfFromCanvases(canvases);
  }

  async function downloadSavingsReport(snapshot) {
    const blob = buildSavingsPdf(snapshot); const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = `${safeFileName(snapshot.company)}_时能智析购电成本测算报告.pdf`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); return blob;
  }

  return { PRODUCT_NAME, PRODUCT_NAME_EN, buildSavingsReport, buildSavingsPdf, downloadSavingsReport, getReportPageCount };
});
