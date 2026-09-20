(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TouTemplate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function monthIndexFromLabel(value) {
    const text = String(value || "").trim();
    const match = text.match(/(?:^|[-年])(\d{1,2})月?$/) || text.match(/^(\d{1,2})月$/);
    if (!match) return -1;
    const monthIndex = Number(match[1]) - 1;
    return monthIndex >= 0 && monthIndex < 12 ? monthIndex : -1;
  }

  function monthIndexFromValue(value) {
    const labelIndex = monthIndexFromLabel(value);
    if (labelIndex >= 0) return labelIndex;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getMonth();
    const numeric = toFiniteNumber(value);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 12) return numeric - 1;
    if (Number.isFinite(numeric) && numeric > 31) {
      const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(numeric) * 86400000);
      return date.getUTCMonth();
    }
    const match = String(value || "").match(/(?:19|20)\d{2}[-/.年](\d{1,2})/);
    if (!match) return -1;
    const monthIndex = Number(match[1]) - 1;
    return monthIndex >= 0 && monthIndex < 12 ? monthIndex : -1;
  }

  function normalizePackage(value) {
    return String(value || "").includes("带现货") ? "spot" : "term";
  }

  function toFiniteNumber(value) {
    if (value === null || value === undefined || String(value).trim() === "") return NaN;
    return Number(value);
  }

  function findSheet(workbook, name) {
    return workbook.sheets.find((sheet) => sheet.name === name);
  }

  function findHeaderRow(rows, requiredLabels) {
    return rows.findIndex((row) =>
      requiredLabels.every((label) => row.some((value) => String(value || "").trim() === label)),
    );
  }

  function cloneMonthlyArray(values) {
    return Array.from({ length: 12 }, (_, index) => {
      const value = values?.[index];
      if (Array.isArray(value)) return [...value];
      if (value && typeof value === "object") return { ...value };
      return value ?? null;
    });
  }

  function getAvailableMonthIndexes(termPrices, spotPrices, gridInputs, bandCodes) {
    return Array.from({ length: 12 }, (_, index) => index).filter(
      (index) => termPrices[index] && spotPrices[index] && gridInputs[index] && bandCodes[index],
    );
  }

  function getGridMonthIndexes(gridInputs, bandCodes) {
    return Array.from({ length: 12 }, (_, index) => index).filter(
      (index) => gridInputs[index] && bandCodes[index],
    );
  }

  function latestMonthKey(year, monthIndexes) {
    if (!Number.isFinite(year) || !monthIndexes.length) return "";
    const month = Math.max(...monthIndexes) + 1;
    return `${year}-${String(month).padStart(2, "0")}`;
  }

  function updateOfficialSources(currentData, analysisYear, marketMonthIndexes, gridMonthIndexes) {
    return {
      ...(currentData.officialSources || {}),
      market: {
        ...(currentData.officialSources?.market || {}),
        latestMonth: latestMonthKey(analysisYear, marketMonthIndexes)
          || currentData.officialSources?.market?.latestMonth
          || "",
      },
      grid: {
        ...(currentData.officialSources?.grid || {}),
        latestMonth: latestMonthKey(analysisYear, gridMonthIndexes)
          || currentData.officialSources?.grid?.latestMonth
          || "",
      },
    };
  }

  function yearFromValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getFullYear();
    const match = String(value || "").match(/((?:19|20)\d{2})/);
    return match ? Number(match[1]) : NaN;
  }

  function findAdjacentValue(sheet, label) {
    for (const row of sheet?.rows || []) {
      const index = row.findIndex((value) => String(value || "").trim() === label);
      if (index < 0) continue;
      for (let column = index + 1; column < row.length; column += 1) {
        if (row[column] !== null && row[column] !== undefined && row[column] !== "") return row[column];
      }
    }
    return undefined;
  }

  function findBelowValue(sheet, label) {
    for (let rowIndex = 0; rowIndex < (sheet?.rows || []).length; rowIndex += 1) {
      const column = sheet.rows[rowIndex].findIndex((value) => String(value || "").trim() === label);
      if (column < 0) continue;
      for (let next = rowIndex + 1; next < sheet.rows.length; next += 1) {
        const value = sheet.rows[next][column];
        if (value !== null && value !== undefined && value !== "") return value;
      }
    }
    return undefined;
  }

  function parseBandCode(value) {
    const text = String(value || "").trim();
    if (text.includes("尖峰")) return "S";
    if (text.includes("高峰")) return "H";
    if (text.includes("低谷")) return "V";
    if (text.includes("平段")) return "P";
    return "";
  }

  function parseHourlyMonthMatrix(sheet) {
    const headerIndex = findHeaderRow(sheet.rows, ["时段", "1月"]);
    if (headerIndex < 0) throw new Error(`${sheet.name} 未找到“时段/月份”表头。`);
    const header = sheet.rows[headerIndex];
    const monthColumns = header
      .map((value, index) => ({ index, monthIndex: monthIndexFromLabel(value) }))
      .filter((item) => item.monthIndex >= 0);
    const hourRows = sheet.rows
      .slice(headerIndex + 1)
      .filter((row) => /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(String(row[0] || "").trim()))
      .slice(0, 24);
    if (hourRows.length !== 24 || !monthColumns.length) {
      throw new Error(`${sheet.name} 未识别到完整的 24 小时数据。`);
    }
    return { monthColumns, hourRows };
  }

  function parseGridSupportFees(workbook, currentData) {
    const componentLabels = ["上网环节线损", "电量输配电价", "政府性基金及附加", "系统运行费折价"];
    const sourceSheet = workbook.sheets.find((sheet) =>
      findHeaderRow(sheet.rows, ["月份", ...componentLabels]) >= 0,
    );
    if (!sourceSheet) {
      return {
        gridSupportFees: currentData.gridSupportFees || Array(12).fill(null),
        supportFeeNote: currentData.supportFeeNote || "",
      };
    }

    const headerIndex = findHeaderRow(sourceSheet.rows, ["月份", ...componentLabels]);
    const headers = sourceSheet.rows[headerIndex].map((value) => String(value || "").trim());
    const columns = {
      month: headers.indexOf("月份"),
      total: headers.indexOf("其他费用"),
      lineLoss: headers.indexOf("上网环节线损"),
      transmission: headers.indexOf("电量输配电价"),
      governmentFund: headers.indexOf("政府性基金及附加"),
      systemOperation: headers.indexOf("系统运行费折价"),
    };
    const gridSupportFees = cloneMonthlyArray(currentData.gridSupportFees);
    sourceSheet.rows.slice(headerIndex + 1).forEach((row) => {
      const monthIndex = monthIndexFromValue(row[columns.month]);
      if (monthIndex < 0) return;
      const fee = {
        lineLoss: toFiniteNumber(row[columns.lineLoss]),
        transmission: toFiniteNumber(row[columns.transmission]),
        governmentFund: toFiniteNumber(row[columns.governmentFund]),
        systemOperation: toFiniteNumber(row[columns.systemOperation]),
      };
      const components = Object.values(fee);
      if (!components.some(Number.isFinite)) return;
      const calculatedTotal = components.every(Number.isFinite)
        ? components.reduce((sum, value) => sum + value, 0)
        : NaN;
      const sourceTotal = columns.total >= 0 ? toFiniteNumber(row[columns.total]) : NaN;
      fee.total = Number.isFinite(sourceTotal) ? sourceTotal : calculatedTotal;
      gridSupportFees[monthIndex] = fee;
    });
    const supportFeeNote = sourceSheet.rows
      .flat()
      .map((value) => String(value || "").trim())
      .find((value) => value.startsWith("注：")) || currentData.supportFeeNote || "";
    return { gridSupportFees, supportFeeNote };
  }

  function parsePriceWorkbook(workbook, fileName, currentData) {
    const periodSheet = findSheet(workbook, "国网峰平谷时段") || findSheet(workbook, "峰平谷时段");
    const termSheet = findSheet(workbook, "旬及以上基础价");
    const spotSheet = findSheet(workbook, "带现货基础价");
    const gridSheet = findSheet(workbook, "国网分时电价");
    if (!periodSheet || !termSheet || !spotSheet || !gridSheet) {
      throw new Error("模板需要包含国网峰平谷时段（兼容原名“峰平谷时段”）、旬及以上基础价、带现货基础价、国网分时电价四个工作表。");
    }

    const period = parseHourlyMonthMatrix(periodSheet);
    const titleText = periodSheet.rows.flat().map((value) => String(value || "")).join(" ");
    const yearMatch = titleText.match(/(?:19|20)\d{2}/);
    const analysisYear = yearMatch ? Number(yearMatch[0]) : currentData.analysisYear;
    const bandCodes = cloneMonthlyArray(currentData.bandCodes);
    period.monthColumns.forEach(({ index, monthIndex }) => {
      const codes = period.hourRows.map((row) => parseBandCode(row[index]));
      if (codes.every(Boolean)) bandCodes[monthIndex] = codes.join("");
    });
    const parseBaseSheet = (sheet, existingValues) => {
      const parsed = parseHourlyMonthMatrix(sheet);
      const matrix = cloneMonthlyArray(existingValues);
      parsed.monthColumns.forEach(({ index, monthIndex }) => {
        const values = parsed.hourRows.map((row) => toFiniteNumber(row[index]));
        if (values.every(Number.isFinite)) matrix[monthIndex] = values;
      });
      return matrix;
    };
    const termPrices = parseBaseSheet(termSheet, currentData.termPrices);
    const spotPrices = parseBaseSheet(spotSheet, currentData.spotPrices);

    const gridHeaderIndex = findHeaderRow(gridSheet.rows, ["月份", "平段基价", "折价电费"]);
    if (gridHeaderIndex < 0) throw new Error("国网分时电价未找到月份、平段基价和折价电费。");
    const gridFormulaText = gridSheet.rows
      .flat()
      .map((value) => String(value || "").trim())
      .find((value) => value.includes("计算公式")) || currentData.gridFormulaText;
    const gridHeader = gridSheet.rows[gridHeaderIndex].map((value) => String(value || "").trim());
    const monthColumn = gridHeader.indexOf("月份");
    const baseColumn = gridHeader.indexOf("平段基价");
    const adjustmentColumn = gridHeader.indexOf("折价电费");
    const levelColumns = {
      S: gridHeader.indexOf("尖峰电价"),
      H: gridHeader.indexOf("高峰电价"),
      P: gridHeader.indexOf("平段电价"),
      V: gridHeader.indexOf("低谷电价"),
    };
    const gridInputs = cloneMonthlyArray(currentData.gridInputs);
    const gridLevels = cloneMonthlyArray(currentData.gridLevels);
    gridSheet.rows.slice(gridHeaderIndex + 1).forEach((row) => {
      const monthIndex = monthIndexFromLabel(row[monthColumn]);
      const base = toFiniteNumber(row[baseColumn]);
      const adjustment = toFiniteNumber(row[adjustmentColumn]);
      if (monthIndex < 0 || !Number.isFinite(base) || !Number.isFinite(adjustment)) return;
      gridInputs[monthIndex] = [base, adjustment];
      const calculated = {
        S: base * 1.92 + adjustment,
        H: base * 1.6 + adjustment,
        P: base + adjustment,
        V: base * 0.45 + adjustment,
      };
      gridLevels[monthIndex] = Object.fromEntries(
        Object.entries(levelColumns).map(([code, column]) => {
          const parsed = column >= 0 ? toFiniteNumber(row[column]) : NaN;
          return [code, Number.isFinite(parsed) ? parsed : calculated[code]];
        }),
      );
    });

    const comparisonSheet = findSheet(workbook, "套餐电价对比");
    const savingsSheet = findSheet(workbook, "电费节省分析");
    const packageText = findBelowValue(comparisonSheet, "当前选择")
      ?? findBelowValue(savingsSheet, "当前选择/数值");
    const markupValue = findAdjacentValue(comparisonSheet, "统一加价(元/MWh)")
      ?? findAdjacentValue(savingsSheet, "统一加价(元/MWh)");
    const gridMonthIndexes = getGridMonthIndexes(gridInputs, bandCodes);
    const marketMonthIndexes = Array.from({ length: 12 }, (_, index) => index).filter(
      (index) => termPrices[index] && spotPrices[index],
    );
    const priceMonthIndexes = getAvailableMonthIndexes(termPrices, spotPrices, gridInputs, bandCodes);
    if (!priceMonthIndexes.length) throw new Error("模板中没有可联动计算的完整月份。");
    const supportFees = parseGridSupportFees(workbook, currentData);

    return {
      ...currentData,
      sourceName: fileName,
      analysisYear,
      gridFormulaText,
      bandCodes,
      termPrices,
      spotPrices,
      gridInputs,
      gridLevels,
      gridMonthIndexes,
      officialSources: updateOfficialSources(currentData, analysisYear, marketMonthIndexes, gridMonthIndexes),
      officialUpdatedAt: new Date().toISOString().slice(0, 10),
      ...supportFees,
      priceMonthIndexes,
      coveredMonths: priceMonthIndexes.length,
      defaultPackage: normalizePackage(packageText),
      defaultMarkup: Number.isFinite(Number(markupValue)) ? Number(markupValue) : 20,
    };
  }

  function parseOfficialMarketWorkbook(workbook, fileName, currentData) {
    const required = ["价格名称", "月份"];
    let sourceSheet = null;
    let headerIndex = -1;
    for (const sheet of workbook.sheets || []) {
      const index = findHeaderRow(sheet.rows || [], required);
      if (index >= 0) {
        sourceSheet = sheet;
        headerIndex = index;
        break;
      }
    }
    if (!sourceSheet) throw new Error("未找到官网导出表中的“价格名称/月份”表头。");

    const headers = sourceSheet.rows[headerIndex].map((value) => String(value || "").trim());
    const priceNameColumn = headers.indexOf("价格名称");
    const monthColumn = headers.indexOf("月份");
    const hourColumns = Array.from({ length: 24 }, (_, index) => headers.indexOf(`时段${index + 1}`));
    if (hourColumns.some((index) => index < 0)) {
      throw new Error("官网导出表没有完整的时段1—时段24数据。");
    }

    const termPrices = cloneMonthlyArray(currentData.termPrices);
    const spotPrices = cloneMonthlyArray(currentData.spotPrices);
    const updatedTermMonths = new Set();
    const updatedSpotMonths = new Set();
    const years = new Set();

    sourceSheet.rows.slice(headerIndex + 1).forEach((row) => {
      const priceName = String(row[priceNameColumn] || "").replace(/\s+/g, "");
      const monthIndex = monthIndexFromValue(row[monthColumn]);
      const year = yearFromValue(row[monthColumn]);
      const values = hourColumns.map((column) => toFiniteNumber(row[column]));
      if (monthIndex < 0 || !values.every(Number.isFinite)) return;
      if (Number.isFinite(year)) years.add(year);
      if (priceName.includes("中长期分时段加权出清电价")) {
        termPrices[monthIndex] = values;
        updatedTermMonths.add(monthIndex);
      } else if (priceName.includes("实时现货加权出清电价")) {
        spotPrices[monthIndex] = values;
        updatedSpotMonths.add(monthIndex);
      }
    });

    if (!updatedTermMonths.size && !updatedSpotMonths.size) {
      throw new Error("官网导出表中未识别到旬及以上或带现货基础价。");
    }
    const priceMonthIndexes = getAvailableMonthIndexes(
      termPrices,
      spotPrices,
      currentData.gridInputs,
      currentData.bandCodes,
    );
    const updatedMonths = [...new Set([...updatedTermMonths, ...updatedSpotMonths])].sort((a, b) => a - b);
    const analysisYear = years.size === 1 ? [...years][0] : currentData.analysisYear;
    const marketMonthIndexes = Array.from({ length: 12 }, (_, index) => index).filter(
      (index) => termPrices[index] && spotPrices[index],
    );
    return {
      ...currentData,
      sourceName: fileName,
      analysisYear,
      termPrices,
      spotPrices,
      officialSources: updateOfficialSources(
        currentData,
        analysisYear,
        marketMonthIndexes,
        currentData.gridMonthIndexes || [],
      ),
      officialUpdatedAt: new Date().toISOString().slice(0, 10),
      priceMonthIndexes,
      coveredMonths: priceMonthIndexes.length,
      officialMarketUpdate: {
        fileName,
        updatedMonthIndexes: updatedMonths,
        termMonthIndexes: [...updatedTermMonths].sort((a, b) => a - b),
        spotMonthIndexes: [...updatedSpotMonths].sort((a, b) => a - b),
      },
    };
  }

  function mergeOfficialGridMonth(update, currentData) {
    const monthIndex = monthIndexFromValue(update.month ?? `${update.year || ""}-${update.monthNumber || ""}`);
    if (monthIndex < 0) throw new Error("国网更新数据缺少有效月份。");
    const scale = update.unit === "元/千瓦时" ? 1000 : 1;
    const base = toFiniteNumber(update.basePrice) * scale;
    const adjustment = toFiniteNumber(update.adjustment) * scale;
    if (!Number.isFinite(base) || !Number.isFinite(adjustment)) {
      throw new Error("国网更新数据缺少平段基价或折价电费。");
    }

    const bandCodes = cloneMonthlyArray(currentData.bandCodes);
    if (Array.isArray(update.hourlyBands)) {
      const parsed = update.hourlyBands.map(parseBandCode);
      if (parsed.length !== 24 || !parsed.every(Boolean)) throw new Error("国网峰平谷时段必须完整覆盖24小时。");
      bandCodes[monthIndex] = parsed.join("");
    } else if (typeof update.bandCode === "string" && /^[SHPV]{24}$/.test(update.bandCode)) {
      bandCodes[monthIndex] = update.bandCode;
    }
    if (!bandCodes[monthIndex]) throw new Error("国网更新数据缺少该月24小时峰平谷时段。");

    const calculatedLevels = {
      S: base * 1.92 + adjustment,
      H: base * 1.6 + adjustment,
      P: base + adjustment,
      V: base * 0.45 + adjustment,
    };
    const suppliedLevels = update.levels || {};
    const gridLevels = cloneMonthlyArray(currentData.gridLevels);
    gridLevels[monthIndex] = Object.fromEntries(Object.entries(calculatedLevels).map(([code, value]) => {
      const supplied = toFiniteNumber(suppliedLevels[code]);
      return [code, Number.isFinite(supplied) ? supplied * scale : value];
    }));
    const gridInputs = cloneMonthlyArray(currentData.gridInputs);
    gridInputs[monthIndex] = [base, adjustment];

    const gridSupportFees = cloneMonthlyArray(currentData.gridSupportFees);
    if (update.supportFee) {
      const fee = {
        lineLoss: toFiniteNumber(update.supportFee.lineLoss),
        transmission: toFiniteNumber(update.supportFee.transmission),
        governmentFund: toFiniteNumber(update.supportFee.governmentFund),
        systemOperation: toFiniteNumber(update.supportFee.systemOperation),
      };
      if (!Object.values(fee).every(Number.isFinite)) throw new Error("国网其他费用四项数据不完整。");
      fee.total = Object.values(fee).reduce((sum, value) => sum + value, 0);
      gridSupportFees[monthIndex] = fee;
    }

    const gridMonthIndexes = getGridMonthIndexes(gridInputs, bandCodes);
    const priceMonthIndexes = getAvailableMonthIndexes(
      currentData.termPrices,
      currentData.spotPrices,
      gridInputs,
      bandCodes,
    );
    const analysisYear = Number(update.year) || currentData.analysisYear;
    return {
      ...currentData,
      analysisYear,
      bandCodes,
      gridInputs,
      gridLevels,
      gridSupportFees,
      gridMonthIndexes,
      priceMonthIndexes,
      coveredMonths: priceMonthIndexes.length,
      officialSources: updateOfficialSources(
        currentData,
        analysisYear,
        Array.from({ length: 12 }, (_, index) => index).filter(
          (index) => currentData.termPrices[index] && currentData.spotPrices[index],
        ),
        gridMonthIndexes,
      ),
      officialUpdatedAt: new Date().toISOString().slice(0, 10),
      officialGridUpdate: { monthIndex, year: analysisYear },
    };
  }

  function parseAnyPriceWorkbook(workbook, fileName, currentData) {
    const sheetNames = new Set((workbook.sheets || []).map((sheet) => sheet.name));
    const hasFullTemplate = ["旬及以上基础价", "带现货基础价", "国网分时电价"].every(
      (name) => sheetNames.has(name),
    );
    return hasFullTemplate
      ? parsePriceWorkbook(workbook, fileName, currentData)
      : parseOfficialMarketWorkbook(workbook, fileName, currentData);
  }

  return { parsePriceWorkbook, parseOfficialMarketWorkbook, mergeOfficialGridMonth, parseAnyPriceWorkbook };
});
