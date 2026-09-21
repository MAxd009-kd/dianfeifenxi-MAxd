(function () {
  "use strict";

  function calculateUserPackageComparison(energyByMonth, termPrices, spotPrices, monthIndexes, markup = 0) {
    const result = {
      monthIndexes: [],
      totalEnergy: 0,
      termCost: 0,
      spotCost: 0,
      difference: 0,
      cheaperType: "equal",
      termLowerMonths: 0,
      spotLowerMonths: 0,
      equalMonths: 0,
    };
    const commonMarkup = Number.isFinite(Number(markup)) ? Number(markup) : 0;
    const completePrices = (values) =>
      Array.isArray(values) &&
      values.length >= 24 &&
      values.slice(0, 24).every((value) => value !== null && value !== "" && Number.isFinite(Number(value)));

    monthIndexes.forEach((monthIndex) => {
      const energy = energyByMonth.get(monthIndex);
      const term = termPrices?.[monthIndex];
      const spot = spotPrices?.[monthIndex];
      if (!Array.isArray(energy) || energy.length < 24 || !completePrices(term) || !completePrices(spot)) return;
      const totalEnergy = energy.slice(0, 24).reduce((sum, value) => sum + (Number(value) || 0), 0);
      if (totalEnergy <= 0) return;
      const termCost = energy.slice(0, 24).reduce(
        (sum, value, hourIndex) => sum + (Number(value) || 0) * (Number(term[hourIndex]) + commonMarkup),
        0,
      );
      const spotCost = energy.slice(0, 24).reduce(
        (sum, value, hourIndex) => sum + (Number(value) || 0) * (Number(spot[hourIndex]) + commonMarkup),
        0,
      );
      result.monthIndexes.push(monthIndex);
      result.totalEnergy += totalEnergy;
      result.termCost += termCost;
      result.spotCost += spotCost;
      if (termCost < spotCost - 0.005) result.termLowerMonths += 1;
      else if (spotCost < termCost - 0.005) result.spotLowerMonths += 1;
      else result.equalMonths += 1;
    });

    result.difference = Math.abs(result.termCost - result.spotCost);
    if (result.termCost < result.spotCost - 0.005) result.cheaperType = "term";
    else if (result.spotCost < result.termCost - 0.005) result.cheaperType = "spot";
    return result;
  }

  function calculatePlanChange(energyByMonth, termPrices, spotPrices, currentPlan, alternativePlan) {
    const result = {
      monthIndexes: [],
      totalEnergy: 0,
      currentCost: 0,
      alternativeCost: 0,
      saving: 0,
    };
    const plans = [currentPlan, alternativePlan].map((plan) => ({
      type: plan?.type === "spot" ? "spot" : "term",
      markup: Number.isFinite(Number(plan?.markup)) ? Number(plan.markup) : 0,
    }));
    const completePrices = (values) =>
      Array.isArray(values) &&
      values.length >= 24 &&
      values.slice(0, 24).every((value) => value !== null && value !== "" && Number.isFinite(Number(value)));

    [...energyByMonth.keys()].sort((left, right) => left - right).forEach((monthIndex) => {
      const energy = energyByMonth.get(monthIndex);
      const currentBase = plans[0].type === "spot" ? spotPrices?.[monthIndex] : termPrices?.[monthIndex];
      const alternativeBase = plans[1].type === "spot" ? spotPrices?.[monthIndex] : termPrices?.[monthIndex];
      if (!Array.isArray(energy) || energy.length < 24 || !completePrices(currentBase) || !completePrices(alternativeBase)) return;
      const values = energy.slice(0, 24).map((value) => Number(value) || 0);
      const totalEnergy = values.reduce((sum, value) => sum + value, 0);
      if (totalEnergy <= 0) return;
      result.monthIndexes.push(monthIndex);
      result.totalEnergy += totalEnergy;
      result.currentCost += values.reduce(
        (sum, value, hourIndex) => sum + value * (Number(currentBase[hourIndex]) + plans[0].markup),
        0,
      );
      result.alternativeCost += values.reduce(
        (sum, value, hourIndex) => sum + value * (Number(alternativeBase[hourIndex]) + plans[1].markup),
        0,
      );
    });
    result.saving = result.currentCost - result.alternativeCost;
    return result;
  }

  function calculateHourlyArithmeticMean(seriesList) {
    const completeSeries = (Array.isArray(seriesList) ? seriesList : [])
      .filter((series) =>
        Array.isArray(series) &&
        series.length >= 24 &&
        series.slice(0, 24).every((value) => value !== null && value !== "" && Number.isFinite(Number(value))),
      )
      .map((series) => series.slice(0, 24).map(Number));
    if (!completeSeries.length) return null;
    return Array.from({ length: 24 }, (_, hourIndex) =>
      completeSeries.reduce((sum, series) => sum + series[hourIndex], 0) / completeSeries.length,
    );
  }

  if (typeof module === "object" && module.exports) {
    module.exports = { calculateUserPackageComparison, calculatePlanChange, calculateHourlyArithmeticMean };
  }

  let data = globalThis.TouPriceData;
  const engine = globalThis.HourlyEngine;
  const templateParser = globalThis.TouTemplate;
  if (!data || !engine || !templateParser) return;

  const panel = document.querySelector("#tou-panel");
  const companyLabel = document.querySelector("#tou-company");
  const templateInput = document.querySelector("#tou-template-input");
  const templateButton = document.querySelector("#tou-template-button");
  const templateName = document.querySelector("#tou-template-name");
  const officialStatus = document.querySelector("#tou-official-status");
  const packageSelect = document.querySelector("#tou-package");
  const markupInput = document.querySelector("#tou-markup");
  const alternativePackageSelect = document.querySelector("#tou-alternative-package");
  const alternativeMarkupInput = document.querySelector("#tou-alternative-markup");
  const gridFormulaText = document.querySelector("#tou-grid-formula-text");
  const supportFeeNote = document.querySelector("#tou-support-fee-note");
  const supportFeeAverage = document.querySelector("#tou-support-fee-average");
  const supportFeeChart = document.querySelector("#tou-support-fee-chart");
  const capacityDemandNote = document.querySelector("#tou-capacity-demand-note");
  const termDownloadButton = document.querySelector("#download-tou-term");
  const spotDownloadButton = document.querySelector("#download-tou-spot");
  const customerReportButton = document.querySelector("#download-customer-report");
  const note = document.querySelector("#tou-note");
  const dataViewSelect = document.querySelector("#tou-data-view");
  const tabs = [...document.querySelectorAll("[data-tou-tab]")];
  const views = [...document.querySelectorAll("[data-tou-panel]")];
  let templateHandle = null;
  let templateSignature = "";
  let templateTimer = null;
  let templateLoading = false;
  const TEMPLATE_DB_NAME = "hourly-data-tool-settings";
  const TEMPLATE_DB_VERSION = 1;
  const TEMPLATE_STORE_NAME = "linked-files";
  const TEMPLATE_HANDLE_KEY = "tou-price-source";

  const state = {
    monthly: null,
    company: "",
    sourceFamily: "",
    sourceMonthIndexes: [],
    availableMonthIndexes: [],
  };
  const allMonthIndexes = Array.from({ length: 12 }, (_, index) => index);

  const numberFormat = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
  const moneyFormat = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const supportFeeFormat = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function monthIndexFromKey(month) {
    const match = String(month || "").match(/-(\d{2})$/);
    return match ? Number(match[1]) - 1 : -1;
  }

  function getFileSignature(file) {
    return `${file.name}|${file.size}|${file.lastModified}`;
  }

  function renderOfficialStatus() {
    if (!officialStatus) return;
    const marketMonth = data.officialSources?.market?.latestMonth || "待更新";
    const gridMonth = data.officialSources?.grid?.latestMonth || "待更新";
    const updatedAt = data.officialUpdatedAt ? `；最近写入 ${data.officialUpdatedAt}` : "";
    officialStatus.textContent = `官网增量更新：国网价格及其他费用每月5日检查，当前已到 ${gridMonth}；旬及以上／带现货基础价每月22日检查，当前已到 ${marketMonth}${updatedAt}。发现新月份时只更新对应月份，其余月份保留。`;
  }

  function openTemplateDatabase() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in globalThis)) {
        resolve(null);
        return;
      }
      const request = indexedDB.open(TEMPLATE_DB_NAME, TEMPLATE_DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(TEMPLATE_STORE_NAME)) {
          request.result.createObjectStore(TEMPLATE_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveTemplateHandle(handle) {
    const database = await openTemplateDatabase();
    if (!database) return;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(TEMPLATE_STORE_NAME, "readwrite");
      transaction.objectStore(TEMPLATE_STORE_NAME).put(handle, TEMPLATE_HANDLE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }

  async function readTemplateHandle() {
    const database = await openTemplateDatabase();
    if (!database) return null;
    const handle = await new Promise((resolve, reject) => {
      const transaction = database.transaction(TEMPLATE_STORE_NAME, "readonly");
      const request = transaction.objectStore(TEMPLATE_STORE_NAME).get(TEMPLATE_HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return handle;
  }

  async function clearTemplateHandle() {
    const database = await openTemplateDatabase();
    if (!database) return;
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(TEMPLATE_STORE_NAME, "readwrite");
      transaction.objectStore(TEMPLATE_STORE_NAME).delete(TEMPLATE_HANDLE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  }

  async function getTemplatePermission(handle, requestAccess = false) {
    if (!handle || typeof handle.queryPermission !== "function") return "granted";
    let permission = await handle.queryPermission({ mode: "read" });
    if (permission !== "granted" && requestAccess && typeof handle.requestPermission === "function") {
      permission = await handle.requestPermission({ mode: "read" });
    }
    return permission;
  }

  async function loadTemplateFile(file, options = {}) {
    if (templateLoading) return false;
    templateLoading = true;
    templateButton.disabled = true;
    templateButton.textContent = "正在读取…";
    try {
      const workbook = await engine.parseXlsx(await file.arrayBuffer(), JSZip);
      data = templateParser.parseAnyPriceWorkbook(workbook, file.name, data);
      packageSelect.value = data.defaultPackage;
      markupInput.value = String(data.defaultMarkup);
      templateSignature = getFileSignature(file);
      templateName.textContent = options.watching
        ? `${file.name} · 已绑定并自动检查更新`
        : `${file.name} · 已载入（更新后请重新选择）`;
      renderBaseTable("#tou-term-table", data.termPrices);
      renderBaseTable("#tou-spot-table", data.spotPrices);
      renderSupportFeeTable();
      renderOfficialStatus();
      refreshAll();
      globalThis.showStatus?.(
        options.auto
          ? `检测到模板已更新，已自动重新计算：${file.name}。`
          : options.restored
            ? `已自动读取绑定的电价数据：${file.name}。`
          : `已读取最新电价分析模板：${file.name}。`,
        false,
      );
      return true;
    } catch (error) {
      console.error(error);
      templateName.textContent = "读取失败，继续使用上一次成功的数据";
      globalThis.showStatus?.(`电价分析模板读取失败：${error.message}`, true);
      return false;
    } finally {
      templateLoading = false;
      templateButton.disabled = false;
      templateButton.textContent = templateHandle ? "更换或刷新 Excel" : "绑定或刷新 Excel";
      templateInput.value = "";
    }
  }

  function stopTemplateWatch() {
    if (templateTimer) clearInterval(templateTimer);
    templateTimer = null;
  }

  function startTemplateWatch() {
    stopTemplateWatch();
    if (!templateHandle) return;
    templateTimer = setInterval(async () => {
      if (templateLoading) return;
      try {
        const file = await templateHandle.getFile();
        if (getFileSignature(file) !== templateSignature) {
          await loadTemplateFile(file, { auto: true, watching: true });
        }
      } catch (error) {
        console.warn("模板自动监测已停止", error);
        stopTemplateWatch();
        templateName.textContent = "文件访问权限已失效，点击按钮重新授权";
        templateButton.textContent = "授权并刷新 Excel";
      }
    }, 4000);
  }

  async function chooseTemplateFile() {
    if (typeof globalThis.showOpenFilePicker !== "function") {
      templateInput.click();
      return;
    }
    try {
      if (templateHandle && await getTemplatePermission(templateHandle) !== "granted") {
        const permission = await getTemplatePermission(templateHandle, true);
        if (permission !== "granted") {
          globalThis.showStatus?.("未获得底层数据表读取权限，暂时继续使用当前数据。", true);
          return;
        }
        const rememberedFile = await templateHandle.getFile();
        const loaded = await loadTemplateFile(rememberedFile, { watching: true, restored: true });
        if (loaded) {
          startTemplateWatch();
        }
        return;
      }
      const [handle] = await globalThis.showOpenFilePicker({
        multiple: false,
        types: [{
          description: "Excel 工作簿",
          accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
        }],
      });
      const file = await handle.getFile();
      const loaded = await loadTemplateFile(file, { watching: true });
      if (loaded) {
        templateHandle = handle;
        try {
          await saveTemplateHandle(handle);
          templateButton.textContent = "更换或刷新 Excel";
        } catch (error) {
          console.warn("浏览器未能保存文件绑定", error);
          templateName.textContent = `${file.name} · 已读取，重新打开网页后需再次选择`;
        }
        startTemplateWatch();
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        console.error(error);
        globalThis.showStatus?.(`无法打开电价分析模板：${error.message}`, true);
      }
    }
  }

  async function restoreTemplateFile() {
    if (typeof globalThis.showOpenFilePicker !== "function") return;
    try {
      const handle = await readTemplateHandle();
      if (!handle) return;
      templateHandle = handle;
      const permission = await getTemplatePermission(handle);
      if (permission !== "granted") {
        templateName.textContent = `已记住 ${handle.name}，点击按钮授权更新`;
        templateButton.textContent = "授权并刷新 Excel";
        return;
      }
      const file = await handle.getFile();
      const loaded = await loadTemplateFile(file, { watching: true, restored: true });
      if (loaded) startTemplateWatch();
    } catch (error) {
      console.warn("无法恢复已绑定的电价数据表", error);
      templateHandle = null;
      templateName.textContent = `当前使用内置参考数据：${data.sourceName}；绑定后可自动检查更新`;
      templateButton.textContent = "绑定或刷新 Excel";
    }
  }

  function getPackageName() {
    return packageSelect.value === "spot" ? "带现货套餐" : "旬及以上套餐";
  }

  function getMarkup() {
    return Number.isFinite(Number(markupInput.value)) ? Number(markupInput.value) : 0;
  }

  function getPackageNameByType(type) {
    return type === "spot" ? "带现货套餐" : "旬及以上套餐";
  }

  function getAlternativeMarkup() {
    return Number.isFinite(Number(alternativeMarkupInput.value)) ? Number(alternativeMarkupInput.value) : 0;
  }

  function getBasePrices(monthIndex) {
    const source = packageSelect.value === "spot" ? data.spotPrices : data.termPrices;
    return source[monthIndex] || null;
  }

  function getPackagePrices(monthIndex) {
    const base = getBasePrices(monthIndex);
    if (!base) return null;
    const markup = getMarkup();
    return base.map((value) => value + markup);
  }

  function getPackagePairMonthIndexes() {
    return allMonthIndexes.filter(
      (monthIndex) => Array.isArray(data.termPrices?.[monthIndex]) && Array.isArray(data.spotPrices?.[monthIndex]),
    );
  }

  function getGridLevels(monthIndex) {
    if (data.gridLevels?.[monthIndex]) return data.gridLevels[monthIndex];
    const input = data.gridInputs[monthIndex];
    if (!input) return null;
    const [base, adjustment] = input;
    return {
      S: base * 1.92 + adjustment,
      H: base * 1.6 + adjustment,
      P: base + adjustment,
      V: base * 0.45 + adjustment,
    };
  }

  function getGridPrices(monthIndex) {
    const levels = getGridLevels(monthIndex);
    const codes = data.bandCodes[monthIndex];
    if (!levels || !codes) return null;
    return [...codes].map((code) => levels[code]);
  }

  function getSourceEnergyByMonth() {
    const result = new Map();
    for (const row of state.monthly?.rows || []) {
      const monthIndex = monthIndexFromKey(row[1]);
      if (monthIndex < 0) continue;
      const values = row.slice(2, 26).map((value) => number(value));
      if (!result.has(monthIndex)) result.set(monthIndex, Array(24).fill(0));
      const totals = result.get(monthIndex);
      values.forEach((value, hourIndex) => { totals[hourIndex] += value; });
    }
    return result;
  }

  function getEnergyByMonth() {
    return new Map(
      [...getSourceEnergyByMonth()].filter(([monthIndex]) => data.priceMonthIndexes.includes(monthIndex)),
    );
  }

  function makeCell(tag, value, className = "") {
    const cell = document.createElement(tag);
    cell.textContent = value == null ? "—" : String(value);
    if (className) cell.className = className;
    return cell;
  }

  function renderTable(table, headers, rows, options = {}) {
    const head = document.createElement("tr");
    headers.forEach((header) => head.append(makeCell("th", header)));
    table.tHead.replaceChildren(head);
    const fragment = document.createDocumentFragment();
    rows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr");
      row.forEach((value, columnIndex) => {
        const formatted = typeof value === "number"
          ? (options.numberFormatter
              ? options.numberFormatter.format(value)
              : options.moneyColumns?.includes(columnIndex)
                ? moneyFormat.format(value)
                : numberFormat.format(value))
          : value;
        const td = makeCell("td", formatted);
        if (value === null || value === undefined) td.classList.add("tou-placeholder");
        if (options.cellClass) {
          const className = options.cellClass(value, rowIndex, columnIndex);
          if (className) td.classList.add(className);
        }
        tr.append(td);
      });
      fragment.append(tr);
    });
    table.tBodies[0].replaceChildren(fragment);
  }

  function timeRows(matrix, monthIndexes) {
    return data.hours.map((hour, hourIndex) => [
      hour,
      ...monthIndexes.map((monthIndex) => matrix[monthIndex]?.[hourIndex] ?? null),
    ]);
  }

  function bandClass(value) {
    if (value === "S" || value === "尖峰") return "tou-band-super";
    if (value === "H" || value === "高峰") return "tou-band-peak";
    if (value === "V" || value === "低谷") return "tou-band-valley";
    if (value === "P" || value === "平段") return "tou-band-flat";
    return "";
  }

  function renderBaseTable(tableId, matrix) {
    renderTable(
      document.querySelector(tableId),
      ["时段", ...data.months],
      timeRows(matrix, allMonthIndexes),
    );
  }

  function triggerPriceDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadBasePriceWorkbook(type) {
    const config = type === "spot"
      ? { label: "带现货基础价", matrix: data.spotPrices, button: spotDownloadButton }
      : { label: "旬及以上基础价", matrix: data.termPrices, button: termDownloadButton };
    if (!config.button) return;
    const defaultLabel = config.button.textContent;
    config.button.disabled = true;
    config.button.textContent = "正在生成…";
    try {
      const result = {
        headers: ["时段（元/MWh）", ...data.months],
        rows: timeRows(config.matrix, allMonthIndexes),
        meta: {
          outputMode: "price-table",
          sheetName: config.label,
          autoFilter: false,
        },
      };
      const bytes = await engine.toXlsx(result, globalThis.JSZip);
      triggerPriceDownload(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        `${data.analysisYear || ""}年_${config.label}_24小时分时数据.xlsx`,
      );
      note.textContent = `已导出${config.label}，文件包含1—12月24小时数据，缺少月份保留空白。`;
    } catch (error) {
      console.error(error);
      note.textContent = `${config.label}导出失败：${error.message}`;
    } finally {
      config.button.disabled = false;
      config.button.textContent = defaultLabel;
    }
  }

  function renderSupportFeeTable() {
    const rows = allMonthIndexes.map((monthIndex) => {
      const fee = data.gridSupportFees?.[monthIndex];
      return fee
        ? [data.months[monthIndex], fee.lineLoss, fee.transmission, fee.governmentFund, fee.systemOperation, fee.total]
        : [data.months[monthIndex], null, null, null, null, null];
    });
    renderTable(
      document.querySelector("#tou-support-fee-table"),
      ["月份", "上网环节线损", "电量输配电价", "政府性基金及附加", "系统运行费折价", "国网其他费用合计"],
      rows,
      { numberFormatter: supportFeeFormat },
    );
    const totals = allMonthIndexes.map((monthIndex) => data.gridSupportFees?.[monthIndex]?.total ?? null);
    const availableTotals = totals.filter(Number.isFinite);
    const average = availableTotals.length
      ? availableTotals.reduce((sum, value) => sum + value, 0) / availableTotals.length
      : null;
    supportFeeAverage.textContent = Number.isFinite(average) ? supportFeeFormat.format(average) : "—";
    drawMonthlyBarChart(supportFeeChart, totals, average);
    supportFeeNote.textContent = data.supportFeeNote || "暂无补充说明。";
    renderCapacityDemandTable();
  }

  function renderCapacityDemandTable() {
    const rows = (data.gridCapacityDemandCharges || []).map((item) => [
      "两部制",
      item.voltage,
      item.demandPrice,
      item.capacityPrice,
    ]);
    renderTable(
      document.querySelector("#tou-capacity-demand-table"),
      ["用电分类", "电压等级", "需量电价（元/千瓦·月）", "容量电价（元/千伏安·月）"],
      rows,
      {
        numberFormatter: new Intl.NumberFormat("zh-CN", {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        }),
      },
    );
    capacityDemandNote.textContent = data.capacityDemandNote || "容（需）量电价为固定参考标准。";
  }

  function drawMonthlyBarChart(svg, values, average) {
    svg.replaceChildren();
    svg.setAttribute("aria-label", "国网其他费用1至12月变化柱状图");
    const width = 960;
    const height = 400;
    const margin = { top: 56, right: 42, bottom: 58, left: 92 };
    const numericValues = values.filter(Number.isFinite);
    if (!numericValues.length) {
      svg.append(createSvg("text", { x: width / 2, y: height / 2, "text-anchor": "middle", fill: "#68776f" }, "暂无可绘制的国网其他费用数据"));
      return;
    }

    const minimum = 0;
    const maximum = Math.max(...numericValues) * 1.22;
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const x = (index) => margin.left + ((index + 0.5) / 12) * plotWidth;
    const y = (value) => margin.top + ((maximum - value) / (maximum - minimum)) * plotHeight;

    for (let tick = 0; tick <= 5; tick += 1) {
      const value = minimum + ((maximum - minimum) * tick) / 5;
      const position = y(value);
      svg.append(
        createSvg("line", { x1: margin.left, y1: position, x2: width - margin.right, y2: position, stroke: "#dce5df", "stroke-width": 1 }),
        createSvg("text", { x: margin.left - 12, y: position + 4, "text-anchor": "end", fill: "#68776f", "font-size": 12 }, supportFeeFormat.format(value)),
      );
    }
    allMonthIndexes.forEach((monthIndex) => {
      svg.append(createSvg("text", {
        x: x(monthIndex),
        y: height - 24,
        "text-anchor": "middle",
        fill: "#68776f",
        "font-size": 12,
      }, data.months[monthIndex]));
    });

    const slotWidth = plotWidth / 12;
    const barWidth = slotWidth * 0.58;
    values.forEach((value, monthIndex) => {
      if (!Number.isFinite(value)) return;
      const centerX = x(monthIndex);
      const top = y(value);
      const bar = createSvg("rect", {
        x: centerX - barWidth / 2,
        y: top,
        width: barWidth,
        height: margin.top + plotHeight - top,
        rx: 3,
        fill: "#2f7d5b",
      });
      bar.append(createSvg("title", {}, `${data.months[monthIndex]}：${supportFeeFormat.format(value)} 元/千瓦时`));
      svg.append(
        bar,
        createSvg("text", {
          x: centerX,
          y: top - 9,
          "text-anchor": "middle",
          fill: "#42534a",
          "font-size": 11,
        }, supportFeeFormat.format(value)),
      );
    });

    if (Number.isFinite(average)) {
      const averageY = y(average);
      svg.append(
        createSvg("line", {
          x1: margin.left,
          y1: averageY,
          x2: width - margin.right,
          y2: averageY,
          stroke: "#d97706",
          "stroke-width": 2,
          "stroke-dasharray": "8 6",
        }),
        createSvg("text", {
          x: width - margin.right,
          y: averageY - 9,
          "text-anchor": "end",
          fill: "#9a5a06",
          "font-size": 12,
        }, `平均 ${supportFeeFormat.format(average)}`),
      );
    }
    svg.append(createSvg("text", { x: 14, y: margin.top - 10, fill: "#68776f", "font-size": 12 }, "元/千瓦时"));
  }

  function renderGridTables() {
    gridFormulaText.textContent = data.gridFormulaText || "暂无计算方式说明";
    const inputs = allMonthIndexes.map((monthIndex) => {
      const input = data.gridInputs[monthIndex];
      const levels = getGridLevels(monthIndex);
      if (!input || !levels) return [data.months[monthIndex], null, null, null, null, null, null];
      const [base, adjustment] = input;
      const hasSharpPeriod = String(data.bandCodes?.[monthIndex] || "").includes("S");
      return [data.months[monthIndex], base, adjustment, hasSharpPeriod ? levels.S : null, levels.H, levels.P, levels.V];
    });
    renderTable(
      document.querySelector("#tou-grid-input-table"),
      ["月份", "平段基价", "折价电费", "尖峰电价", "高峰电价", "平段电价", "低谷电价"],
      inputs,
    );
    const matrix = Array(12).fill(null);
    (data.gridMonthIndexes || data.priceMonthIndexes).forEach((index) => {
      matrix[index] = getGridPrices(index);
    });
    renderTable(
      document.querySelector("#tou-grid-table"),
      ["时段", ...data.months],
      timeRows(matrix, allMonthIndexes),
      {
        cellClass(value, rowIndex, columnIndex) {
          if (!columnIndex || typeof value !== "number") return "";
          const monthIndex = allMonthIndexes[columnIndex - 1];
          return bandClass(data.bandCodes[monthIndex]?.[rowIndex]);
        },
      },
    );
  }

  function renderComparison() {
    const monthIndexes = data.priceMonthIndexes;
    const differenceMatrix = Array(12).fill(null);
    monthIndexes.forEach((monthIndex) => {
      const grid = getGridPrices(monthIndex);
      const packagePrices = getPackagePrices(monthIndex);
      differenceMatrix[monthIndex] = grid.map((value, hourIndex) => value - packagePrices[hourIndex]);
    });
    renderTable(
      document.querySelector("#tou-comparison-table"),
      ["时段", ...data.months],
      timeRows(differenceMatrix, allMonthIndexes),
      {
        cellClass(value, rowIndex, columnIndex) {
          if (!columnIndex || typeof value !== "number") return "";
          return value >= 0 ? "tou-positive" : "tou-negative";
        },
      },
    );
  }

  function renderPackagePairComparison() {
    const monthIndexes = getPackagePairMonthIndexes();
    const monthlyRows = allMonthIndexes.map((monthIndex) => {
      const term = data.termPrices?.[monthIndex];
      const spot = data.spotPrices?.[monthIndex];
      if (!term || !spot) return [data.months[monthIndex], null, null, null, null];
      const termAverage = term.reduce((sum, value) => sum + number(value), 0) / term.length;
      const spotAverage = spot.reduce((sum, value) => sum + number(value), 0) / spot.length;
      const difference = termAverage - spotAverage;
      const lowerPackage = difference > 0 ? "带现货" : difference < 0 ? "旬及以上" : "价格相同";
      return [data.months[monthIndex], termAverage, spotAverage, Math.abs(difference), lowerPackage];
    });
    renderTable(
      document.querySelector("#tou-package-pair-summary-table"),
      ["月份", "旬及以上算数均价（元/MWh）", "带现货算数均价（元/MWh）", "两种套餐差值（元/MWh）", "价格较低套餐"],
      monthlyRows,
      {
        cellClass(value, rowIndex, columnIndex) {
          if (columnIndex === 4 && value && value !== "价格相同") return "tou-preferred";
          return "";
        },
      },
    );

  }

  function renderPlanChangeComparison() {
    const currentType = packageSelect.value;
    const alternativeType = alternativePackageSelect.value;
    const currentMarkup = getMarkup();
    const alternativeMarkup = getAlternativeMarkup();
    const result = calculatePlanChange(
      getSourceEnergyByMonth(),
      data.termPrices,
      data.spotPrices,
      { type: currentType, markup: currentMarkup },
      { type: alternativeType, markup: alternativeMarkup },
    );
    const currentName = getPackageNameByType(currentType);
    const alternativeName = getPackageNameByType(alternativeType);
    document.querySelector("#tou-current-plan-summary").textContent = `当前方案：${currentName}＋${numberFormat.format(currentMarkup)} 元/MWh`;
    document.querySelector("#tou-current-plan-cost").textContent = `${moneyFormat.format(result.currentCost)} 元`;
    document.querySelector("#tou-alternative-plan-cost").textContent = `${moneyFormat.format(result.alternativeCost)} 元`;
    const changeElement = document.querySelector("#tou-plan-change-saving");
    const summaryElement = document.querySelector("#tou-plan-change-summary");
    changeElement.textContent = `${result.saving >= 0 ? "节省 " : "增加 "}${moneyFormat.format(Math.abs(result.saving))} 元`;
    if (!result.monthIndexes.length) {
      summaryElement.textContent = "当前企业没有同时覆盖两套方案价格的用电月份，暂不能测算方案调整金额。";
      summaryElement.classList.remove("is-saving", "is-costlier");
      return;
    }
    const months = result.monthIndexes.map((monthIndex) => data.months[monthIndex]).join("、");
    if (Math.abs(result.saving) < 0.005) {
      summaryElement.textContent = `按${months}共${result.monthIndexes.length}个月、${numberFormat.format(result.totalEnergy)} MWh实际用电测算，两套方案费用基本相同。`;
      summaryElement.classList.remove("is-saving", "is-costlier");
    } else if (result.saving > 0) {
      summaryElement.textContent = `从${currentName}＋${numberFormat.format(currentMarkup)}元/MWh调整为${alternativeName}＋${numberFormat.format(alternativeMarkup)}元/MWh，预计可节省${moneyFormat.format(result.saving)}元。`;
      summaryElement.classList.add("is-saving");
      summaryElement.classList.remove("is-costlier");
    } else {
      summaryElement.textContent = `从${currentName}＋${numberFormat.format(currentMarkup)}元/MWh调整为${alternativeName}＋${numberFormat.format(alternativeMarkup)}元/MWh，预计将增加${moneyFormat.format(Math.abs(result.saving))}元。`;
      summaryElement.classList.add("is-costlier");
      summaryElement.classList.remove("is-saving");
    }
    changeElement.classList.toggle("is-saving", result.saving > 0);
    changeElement.classList.toggle("is-costlier", result.saving < 0);
  }

  function drawLineChart(svg, series, label, unit) {
    svg.replaceChildren();
    svg.setAttribute("aria-label", label);
    const width = 960;
    const height = 400;
    const margin = { top: 62, right: 34, bottom: 58, left: 74 };
    const values = series.flatMap((item) => item.values.filter(Number.isFinite));
    if (!values.length) {
      svg.append(createSvg("text", { x: 480, y: 205, "text-anchor": "middle", fill: "#68776f" }, "当前没有可绘制的数据"));
      return;
    }
    let minimum = Math.min(0, ...values);
    let maximum = Math.max(...values);
    if (minimum === maximum) maximum = minimum + 1;
    const padding = (maximum - minimum) * 0.08;
    maximum += padding;
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const x = (index) => margin.left + (index / 23) * plotWidth;
    const y = (value) => margin.top + ((maximum - value) / (maximum - minimum)) * plotHeight;

    for (let tick = 0; tick <= 5; tick += 1) {
      const value = minimum + ((maximum - minimum) * tick) / 5;
      const position = y(value);
      svg.append(
        createSvg("line", { x1: margin.left, y1: position, x2: width - margin.right, y2: position, stroke: "#dce5df", "stroke-width": 1 }),
        createSvg("text", { x: margin.left - 10, y: position + 4, "text-anchor": "end", fill: "#68776f", "font-size": 12 }, numberFormat.format(value)),
      );
    }
    for (let index = 0; index < 24; index += 1) {
      if (index % 2 && index !== 23) continue;
      svg.append(createSvg("text", { x: x(index), y: height - 22, "text-anchor": "middle", fill: "#68776f", "font-size": 12 }, `${index + 1}时`));
    }
    series.forEach((item) => {
      const path = item.values.map((value, index) => `${index ? "L" : "M"}${x(index)},${y(value)}`).join(" ");
      svg.append(createSvg("path", { d: path, fill: "none", stroke: item.color, "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    });
    series.forEach((item, index) => {
      const startX = margin.left + index * 180;
      svg.append(
        createSvg("line", { x1: startX, y1: 25, x2: startX + 28, y2: 25, stroke: item.color, "stroke-width": 4 }),
        createSvg("text", { x: startX + 36, y: 30, fill: "#42534a", "font-size": 13 }, item.label),
      );
    });
    svg.append(createSvg("text", { x: 16, y: margin.top - 8, fill: "#68776f", "font-size": 12 }, unit));
  }

  function createSvg(name, attributes = {}, text = "") {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    if (text) element.textContent = text;
    return element;
  }

  function renderPriceChart() {
    const monthIndexes = data.priceMonthIndexes.filter((monthIndex) => {
      const grid = getGridPrices(monthIndex);
      const packagePrices = getPackagePrices(monthIndex);
      return calculateHourlyArithmeticMean([grid]) && calculateHourlyArithmeticMean([packagePrices]);
    });
    const grid = calculateHourlyArithmeticMean(monthIndexes.map((monthIndex) => getGridPrices(monthIndex)));
    const packagePrices = calculateHourlyArithmeticMean(monthIndexes.map((monthIndex) => getPackagePrices(monthIndex)));
    const monthLabels = monthIndexes.map((monthIndex) => data.months[monthIndex]);
    const title = monthLabels.length
      ? `底层已有月份24小时算术均价对比（${monthLabels.join("、")}）`
      : "底层已有月份24小时算术均价对比";
    document.querySelector("#tou-price-chart-title").textContent = title;
    drawLineChart(
      document.querySelector("#tou-price-chart"),
      grid && packagePrices
        ? [
            { label: "国网电价（算术均值）", values: grid, color: "#2563eb" },
            { label: `${getPackageName()}（算术均值）`, values: packagePrices, color: "#d97706" },
          ]
        : [],
      title,
      "元/MWh",
    );
  }

  function renderSavings() {
    renderPlanChangeComparison();
    const energyByMonth = getEnergyByMonth();
    const monthIndexes = [...energyByMonth.keys()].sort((a, b) => a - b);
    const rows = monthIndexes.map((monthIndex) => {
      const energy = energyByMonth.get(monthIndex);
      const grid = getGridPrices(monthIndex);
      const packagePrices = getPackagePrices(monthIndex);
      const totalEnergy = energy.reduce((sum, value) => sum + value, 0);
      const gridCost = energy.reduce((sum, value, hourIndex) => sum + value * grid[hourIndex], 0);
      const packageCost = energy.reduce((sum, value, hourIndex) => sum + value * packagePrices[hourIndex], 0);
      const saving = gridCost - packageCost;
      return [data.months[monthIndex], totalEnergy, gridCost, packageCost, saving, totalEnergy ? saving / totalEnergy : 0];
    });
    const totals = rows.reduce(
      (sum, row) => sum.map((value, index) => value + (index ? number(row[index]) : 0)),
      [0, 0, 0, 0, 0, 0],
    );
    totals[0] = "合计";
    totals[5] = totals[1] ? totals[4] / totals[1] : 0;
    renderTable(
      document.querySelector("#tou-savings-table"),
      ["月份", "企业月电量(MWh)", "国网月费用(元)", "套餐月费用(元)", "当月节省(元)", "度电节省(元/MWh)"],
      [...rows, totals],
      { moneyColumns: [2, 3, 4] },
    );

    document.querySelector("#tou-covered-months").textContent = monthIndexes.length;
    document.querySelector("#tou-energy-total").textContent = `${numberFormat.format(totals[1])} MWh`;
    document.querySelector("#tou-grid-cost").textContent = `${moneyFormat.format(totals[2])} 元`;
    document.querySelector("#tou-package-cost").textContent = `${moneyFormat.format(totals[3])} 元`;
    document.querySelector("#tou-saving-total").textContent = `${moneyFormat.format(totals[4])} 元`;
    const recommendation = document.querySelector("#tou-recommendation");
    recommendation.textContent = monthIndexes.length
      ? totals[4] > 0
        ? `测算结果：${getPackageName()}预计节省 ${moneyFormat.format(totals[4])} 元，按当前参数可优先考虑。`
        : `测算结果：${getPackageName()}预计增加 ${moneyFormat.format(Math.abs(totals[4]))} 元，按当前参数暂不建议选择。`
      : "当前企业没有落在模板覆盖月份内的月度电量，暂不能计算节省。";
    recommendation.classList.toggle("is-saving", totals[4] > 0 && monthIndexes.length > 0);
    recommendation.classList.toggle("is-costlier", totals[4] <= 0 && monthIndexes.length > 0);
    if (customerReportButton) {
      customerReportButton.hidden = state.sourceFamily === "bill";
      customerReportButton.disabled = state.sourceFamily === "bill" || !monthIndexes.length;
    }
  }

  async function downloadCustomerReport() {
    const snapshot = getAnalysisSnapshot();
    if (!globalThis.TimeGridReport || !snapshot.months.length) {
      note.textContent = "当前没有可生成客户报告的测算数据。";
      return;
    }
    customerReportButton.disabled = true;
    customerReportButton.textContent = "正在生成PDF…";
    try {
      await globalThis.TimeGridReport.downloadSavingsReport(snapshot);
      note.textContent = `已下载 ${snapshot.company} 的时能智析购电成本测算PDF报告。`;
    } catch (error) {
      console.error(error);
      note.textContent = `PDF报告生成失败：${error.message || "请稍后重试"}`;
    } finally {
      customerReportButton.disabled = false;
      customerReportButton.textContent = "下载PDF报告";
    }
  }

  function getAnalysisSnapshot() {
    const energyByMonth = getEnergyByMonth();
    const monthIndexes = [...energyByMonth.keys()].sort((a, b) => a - b);
    const months = monthIndexes.map((monthIndex) => {
      const energy = energyByMonth.get(monthIndex);
      const grid = getGridPrices(monthIndex);
      const packagePrices = getPackagePrices(monthIndex);
      const totalEnergy = energy.reduce((sum, value) => sum + value, 0);
      const gridCost = energy.reduce((sum, value, hourIndex) => sum + value * grid[hourIndex], 0);
      const packageCost = energy.reduce((sum, value, hourIndex) => sum + value * packagePrices[hourIndex], 0);
      return {
        monthIndex,
        month: data.months[monthIndex],
        energy,
        grid,
        packagePrices,
        totalEnergy,
        gridCost,
        packageCost,
        saving: gridCost - packageCost,
      };
    });
    return {
      sourceName: data.sourceName,
      analysisYear: data.analysisYear,
      company: state.company,
      packageType: packageSelect.value,
      packageName: getPackageName(),
      markup: getMarkup(),
      alternativePackageType: alternativePackageSelect.value,
      alternativePackageName: getPackageNameByType(alternativePackageSelect.value),
      alternativeMarkup: getAlternativeMarkup(),
      priceMonthIndexes: [...data.priceMonthIndexes],
      months,
    };
  }

  function refreshAll() {
    if (!state.monthly) return;
    companyLabel.textContent = state.company || "—";
    renderGridTables();
    renderPackagePairComparison();
    renderComparison();
    renderPriceChart();
    renderSavings();
    const priceMonths = data.priceMonthIndexes.map((index) => data.months[index]).join("、");
    const gridMonths = (data.gridMonthIndexes || data.priceMonthIndexes)
      .map((index) => data.months[index])
      .join("、");
    note.textContent = state.sourceMonthIndexes.length
      ? `已按月份读取 ${state.company} 的 ${state.sourceMonthIndexes.length} 个月电量；国网分时电价已更新至 ${gridMonths}，具备套餐对比和成本测算条件的月份为 ${priceMonths}。所有表格均保留 1—12 月位置。`
      : `当前企业没有可匹配的月度电量。国网分时电价已更新至 ${gridMonths}，具备完整套餐价格的月份为 ${priceMonths}。`;
  }

  function activateView(viewName) {
    const isDataView = ["term", "spot", "grid", "support-fee"].includes(viewName);
    views.forEach((view) => {
      view.hidden = view.dataset.touPanel !== viewName;
    });
    tabs.forEach((tab) => {
      const active = !isDataView && tab.dataset.touTab === viewName;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    document.querySelector(".analysis-data-filter")?.classList.toggle("is-active", isDataView);
    dataViewSelect.value = isDataView ? viewName : "";
    if (viewName === "curves") renderPriceChart();
    if (viewName === "package-pair") renderPackagePairComparison();
  }

  function updateFromSource(detail) {
    const company = detail?.company;
    if (!company) return;
    state.monthly = engine.buildMonthlySummary(detail.sheet.rows, detail.mapping, {
      headerIndex: detail.analysis.headerIndex,
      intervalMode: detail.intervalMode,
      companyFilter: company,
    });
    state.company = company;
    state.sourceFamily = detail.sourceFamily || "";
    state.sourceMonthIndexes = [...new Set(state.monthly.rows
      .map((row) => monthIndexFromKey(row[1]))
      .filter((index) => index >= 0))].sort((a, b) => a - b);
    state.availableMonthIndexes = state.sourceMonthIndexes
      .filter((index) => data.priceMonthIndexes.includes(index));
    panel.hidden = false;
    refreshAll();
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activateView(tab.dataset.touTab);
    });
  });
  dataViewSelect.addEventListener("change", () => activateView(dataViewSelect.value));
  packageSelect.addEventListener("change", refreshAll);
  markupInput.addEventListener("input", refreshAll);
  alternativePackageSelect.addEventListener("change", refreshAll);
  alternativeMarkupInput.addEventListener("input", refreshAll);
  termDownloadButton?.addEventListener("click", () => downloadBasePriceWorkbook("term"));
  spotDownloadButton?.addEventListener("click", () => downloadBasePriceWorkbook("spot"));
  customerReportButton?.addEventListener("click", downloadCustomerReport);
  templateButton.addEventListener("click", chooseTemplateFile);
  templateInput.addEventListener("change", async () => {
    const [file] = templateInput.files;
    if (file) {
      templateHandle = null;
      stopTemplateWatch();
      const loaded = await loadTemplateFile(file);
      if (loaded) {
        try {
          await clearTemplateHandle();
        } catch (error) {
          console.warn("无法清除旧的文件绑定", error);
        }
      }
    }
  });

  renderBaseTable("#tou-term-table", data.termPrices);
  renderBaseTable("#tou-spot-table", data.spotPrices);
  renderSupportFeeTable();
  renderOfficialStatus();
  packageSelect.value = data.defaultPackage;
  markupInput.value = String(data.defaultMarkup);
  alternativePackageSelect.value = data.defaultPackage === "spot" ? "term" : "spot";
  alternativeMarkupInput.value = String(Math.max(0, number(data.defaultMarkup) - 5));
  activateView(dataViewSelect.value || "term");
  templateName.textContent = `当前使用内置官网数据：${data.sourceName}；也可绑定完整模板或官网导出表`;
  templateButton.textContent = "绑定或刷新 Excel";
  window.addEventListener("hourly-data-updated", (event) => updateFromSource(event.detail));
  globalThis.TouAnalysis = {
    parsePriceWorkbook: (workbook, fileName) => templateParser.parsePriceWorkbook(workbook, fileName, data),
    parseOfficialMarketWorkbook: (workbook, fileName) => templateParser.parseOfficialMarketWorkbook(workbook, fileName, data),
    mergeOfficialGridMonth: (update) => templateParser.mergeOfficialGridMonth(update, data),
    getAnalysisSnapshot,
  };
})();
