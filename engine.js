(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.HourlyEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const HOUR_HEADERS = Array.from({ length: 24 }, (_, index) =>
    `${String(index + 1).padStart(2, "0")}时`,
  );
  const DEFAULT_COMPANY_NAME = "电力用户";

  function decodeXml(value) {
    return String(value || "")
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }

  function escapeXml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function getAttribute(source, name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = source.match(new RegExp(`(?:^|\\s)${escapedName}="([^"]*)"`));
    return match ? decodeXml(match[1]) : "";
  }

  function normalizeArchivePath(target) {
    return target.startsWith("/")
      ? target.replace(/^\//, "")
      : `xl/${target.replace(/^\.\//, "").replace(/^xl\//, "")}`;
  }

  function parseSharedStrings(xml) {
    if (!xml) return [];
    const values = [];
    const itemPattern = /<(?:[\w-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?si>/gi;
    let itemMatch;

    while ((itemMatch = itemPattern.exec(xml))) {
      const textParts = [];
      const textPattern = /<(?:[\w-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?t>/gi;
      let textMatch;
      while ((textMatch = textPattern.exec(itemMatch[1]))) {
        textParts.push(decodeXml(textMatch[1]));
      }
      values.push(textParts.join(""));
    }

    return values;
  }

  function columnIndexFromReference(reference) {
    const letters = String(reference).match(/[A-Z]+/i)?.[0]?.toUpperCase() || "A";
    let index = 0;
    for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
    return index - 1;
  }

  function extractTextFragments(cellBody) {
    const parts = [];
    const pattern = /<(?:[\w-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?t>/gi;
    let match;
    while ((match = pattern.exec(cellBody))) parts.push(decodeXml(match[1]));
    return parts.join("");
  }

  function parseWorksheet(xml, sharedStrings) {
    const rows = [];
    const rowPattern = /<(?:[\w-]+:)?row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?row>/gi;
    let rowMatch;

    while ((rowMatch = rowPattern.exec(xml))) {
      const rowIndex = Number(rowMatch[1]) - 1;
      const row = [];
      const cellPattern = /<(?:[\w-]+:)?c\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?c>/gi;
      let cellMatch;

      while ((cellMatch = cellPattern.exec(rowMatch[2]))) {
        const attributes = cellMatch[1];
        const body = cellMatch[2];
        const reference = getAttribute(attributes, "r");
        const type = getAttribute(attributes, "t");
        const columnIndex = columnIndexFromReference(reference);
        const rawValue = body.match(/<(?:[\w-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?v>/i)?.[1] ?? "";
        let value = null;

        if (type === "inlineStr") {
          value = extractTextFragments(body);
        } else if (type === "s") {
          value = sharedStrings[Number(rawValue)] ?? "";
        } else if (type === "str") {
          value = decodeXml(rawValue);
        } else if (type === "b") {
          value = rawValue === "1";
        } else if (type === "e") {
          value = null;
        } else if (rawValue !== "") {
          const numericValue = Number(rawValue);
          value = Number.isFinite(numericValue) ? numericValue : decodeXml(rawValue);
        } else {
          const inlineText = extractTextFragments(body);
          value = inlineText || null;
        }

        row[columnIndex] = value;
      }

      rows[rowIndex] = row;
    }

    return rows.filter(Boolean);
  }

  async function parseXlsx(arrayBuffer, JSZipCtor) {
    if (!JSZipCtor) throw new Error("缺少 Excel 解析组件。");
    const zip = await JSZipCtor.loadAsync(arrayBuffer);
    const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
    const relationshipsXml = await zip
      .file("xl/_rels/workbook.xml.rels")
      ?.async("string");
    if (!workbookXml || !relationshipsXml) throw new Error("无法读取 Excel 工作簿结构。");

    const sharedStringsXml = await zip.file("xl/sharedStrings.xml")?.async("string");
    const sharedStrings = parseSharedStrings(sharedStringsXml || "");
    const relationships = new Map();
    const relationshipPattern = /<Relationship\b([^>]*?)\/?>(?:<\/Relationship>)?/gi;
    let relationshipMatch;

    while ((relationshipMatch = relationshipPattern.exec(relationshipsXml))) {
      const id = getAttribute(relationshipMatch[1], "Id");
      const target = getAttribute(relationshipMatch[1], "Target");
      if (id && target) relationships.set(id, normalizeArchivePath(target));
    }

    const sheets = [];
    const sheetPattern = /<(?:[\w-]+:)?sheet\b([^>]*?)\/?>(?:<\/(?:[\w-]+:)?sheet>)?/gi;
    let sheetMatch;

    while ((sheetMatch = sheetPattern.exec(workbookXml))) {
      const name = getAttribute(sheetMatch[1], "name") || `工作表 ${sheets.length + 1}`;
      const relationshipId = getAttribute(sheetMatch[1], "r:id");
      const path = relationships.get(relationshipId);
      const sheetXml = path ? await zip.file(path)?.async("string") : null;
      if (sheetXml) sheets.push({ name, rows: parseWorksheet(sheetXml, sharedStrings) });
    }

    if (!sheets.length) throw new Error("没有找到可读取的工作表。");
    return { type: "xlsx", sheets };
  }

  function detectDelimiter(text) {
    const sample = text.split(/\r?\n/).find((line) => line.trim()) || "";
    const candidates = [",", "\t", ";"];
    return candidates
      .map((delimiter) => ({ delimiter, count: sample.split(delimiter).length - 1 }))
      .sort((a, b) => b.count - a.count)[0].delimiter;
  }

  function parseCsv(text) {
    const cleaned = String(text).replace(/^\uFEFF/, "");
    const delimiter = detectDelimiter(cleaned);
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let index = 0; index < cleaned.length; index += 1) {
      const character = cleaned[index];
      const nextCharacter = cleaned[index + 1];

      if (character === '"' && inQuotes && nextCharacter === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = !inQuotes;
      } else if (character === delimiter && !inQuotes) {
        row.push(field);
        field = "";
      } else if ((character === "\n" || character === "\r") && !inQuotes) {
        if (character === "\r" && nextCharacter === "\n") index += 1;
        row.push(field);
        if (row.some((value) => String(value).trim() !== "")) rows.push(row);
        row = [];
        field = "";
      } else {
        field += character;
      }
    }

    row.push(field);
    if (row.some((value) => String(value).trim() !== "")) rows.push(row);
    return { type: "csv", sheets: [{ name: "CSV 数据", rows }] };
  }

  const HEADER_CANDIDATES = {
    company: [
      "市场成员名称",
      "企业名称",
      "公司名称",
      "客户名称",
      "用户名称",
      "用电单元名称",
      "电力用户名称",
      "单位名称",
      "主体名称",
      "户名",
    ],
    date: ["日期", "数据日期", "统计日期", "交易日期", "采集日期", "用电日期", "结算日期"],
    time: ["时点", "时间", "时刻", "采集时间", "时间点", "计量时间", "数据时间", "分时时间"],
    value: ["电量mwh", "电量", "用电量", "有功电量", "市场化电量", "电量值", "数值", "value"],
  };

  function semanticHeaderKey(value) {
    const header = normalizeHeader(value);
    if (!header) return "";
    for (const [key, names] of Object.entries(HEADER_CANDIDATES)) {
      const normalizedNames = names.map(normalizeHeader);
      if (normalizedNames.includes(header)) return key;
    }
    for (const [key, names] of Object.entries(HEADER_CANDIDATES)) {
      const matched = names
        .map(normalizeHeader)
        .some(
          (name) =>
            name.length >= 3 && header.length >= 3 && (header.includes(name) || name.includes(header)),
        );
      if (matched) return key;
    }
    return "";
  }

  function findHeaderRow(rows) {
    const scanLimit = Math.min(rows.length, 20);
    let bestIndex = 0;
    let bestScore = -1;

    for (let index = 0; index < scanLimit; index += 1) {
      const row = rows[index] || [];
      const nonEmptyCount = row.filter((value) => String(value ?? "").trim() !== "").length;
      const semanticCount = new Set(row.map(semanticHeaderKey).filter(Boolean)).size;
      const score = semanticCount * 1000 + nonEmptyCount;
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    }

    return bestIndex;
  }

  function analyzeSheet(rows) {
    const headerIndex = findHeaderRow(rows);
    const headers = (rows[headerIndex] || []).map((value, index) => {
      const text = String(value ?? "").trim();
      return text || `未命名列 ${index + 1}`;
    });
    return { headerIndex, headers };
  }

  function normalizeHeader(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[\s_()（）\-]/g, "");
  }

  function normalizeMonth(value, fallbackYear = "") {
    if (typeof value === "number" && Number.isFinite(value) && value > 20000) {
      return normalizeDate(value).slice(0, 7);
    }
    const text = String(value ?? "")
      .trim()
      .replace(/[—–－]/g, "-");
    if (!text) return "";
    const full = text.match(/^(20\d{2})\s*[年\/.\-]\s*(0?[1-9]|1[0-2])\s*月?(?:\s*\([^)]*\))?$/);
    if (full) return `${full[1]}-${full[2].padStart(2, "0")}`;
    const compact = text.match(/^(20\d{2})(0[1-9]|1[0-2])$/);
    if (compact) return `${compact[1]}-${compact[2]}`;
    const shortYear = text.match(/^(\d{2})\s*年\s*(0?[1-9]|1[0-2])\s*月?$/);
    if (shortYear) return `20${shortYear[1]}-${shortYear[2].padStart(2, "0")}`;
    const monthOnly = text.match(/^(0?[1-9]|1[0-2])\s*月$/);
    return monthOnly && /^20\d{2}$/.test(String(fallbackYear))
      ? `${fallbackYear}-${monthOnly[1].padStart(2, "0")}`
      : "";
  }

  function parseMonthlyHour(value) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 24) {
      return value;
    }
    const text = String(value ?? "").trim().replace(/[—–－~～至]/g, "-");
    if (!text) return null;
    const direct = text.match(/^(?:第\s*)?(0?[1-9]|1\d|2[0-4])\s*(?:时|点|小时|h)?$/i);
    if (direct) return Number(direct[1]);
    const range = text.match(/(?:^|\s)(\d{1,2})[:：]00\s*-\s*(\d{1,2})[:：]00(?:\s|$)/);
    if (range) {
      const end = Number(range[2]);
      return end === 0 ? 24 : end >= 1 && end <= 24 ? end : null;
    }
    return null;
  }

  function detectMonthlyMatrix(rows) {
    // A normal detail table can contain 24 consecutive time rows and a date
    // column.  Without this guard, one data date could be mistaken for a
    // single-month matrix header and the original detail source would be
    // truncated to 24 rows.  Established long/wide layouts always take
    // precedence over the optional monthly-matrix layout.
    const standardAnalysis = analyzeSheet(rows);
    const standardMapping = guessMapping(standardAnalysis.headers);
    const standardLayout = detectSourceLayout(standardAnalysis.headers);
    if (
      standardLayout.type === "wide" ||
      Object.values(standardMapping).every((columnIndex) => columnIndex >= 0)
    ) {
      return { type: "unknown", headerIndex: -1, monthColumns: [], hourRows: [] };
    }

    const scanLimit = Math.min(rows.length, 20);
    let best = null;
    for (let headerIndex = 0; headerIndex < scanLimit; headerIndex += 1) {
      const row = rows[headerIndex] || [];
      const contextText = rows
        .slice(Math.max(0, headerIndex - 3), headerIndex + 1)
        .flat()
        .map((value) => String(value ?? ""))
        .join(" ");
      const fallbackYear = contextText.match(/20\d{2}/)?.[0] || "";
      const monthColumns = row
        .map((value, index) => ({ index, month: normalizeMonth(value, fallbackYear) }))
        .filter((item) => item.month);
      if (!monthColumns.length || (best && monthColumns.length <= best.monthColumns.length)) continue;
      best = { headerIndex, monthColumns };
    }
    if (!best) return { type: "unknown", headerIndex: -1, monthColumns: [], hourRows: [] };

    const headers = rows[best.headerIndex] || [];
    const monthColumnIndexes = new Set(best.monthColumns.map((item) => item.index));
    let timeColumn = headers.findIndex((value, index) => {
      if (monthColumnIndexes.has(index)) return false;
      const header = normalizeHeader(value);
      return ["时段", "时间", "时点", "小时", "hour"].includes(header);
    });
    if (timeColumn < 0) {
      const maximumColumns = Math.max(...rows.map((row) => row?.length || 0), 0);
      let bestTimeCount = 0;
      for (let columnIndex = 0; columnIndex < maximumColumns; columnIndex += 1) {
        if (monthColumnIndexes.has(columnIndex)) continue;
        const count = rows
          .slice(best.headerIndex + 1, best.headerIndex + 31)
          .filter((row) => parseMonthlyHour(row?.[columnIndex]) != null).length;
        if (count > bestTimeCount) {
          bestTimeCount = count;
          timeColumn = columnIndex;
        }
      }
      if (bestTimeCount < 20) timeColumn = -1;
    }

    let hourRows = [];
    if (timeColumn >= 0) {
      const byHour = new Map();
      rows.slice(best.headerIndex + 1).forEach((row, offset) => {
        const hour = parseMonthlyHour(row?.[timeColumn]);
        if (hour != null && !byHour.has(hour)) {
          byHour.set(hour, { rowIndex: best.headerIndex + 1 + offset, hour });
        }
      });
      hourRows = [...byHour.values()].sort((a, b) => a.hour - b.hour);
    }

    if (hourRows.length !== 24 || hourRows.some((item, index) => item.hour !== index + 1)) {
      const sequentialRows = rows
        .slice(best.headerIndex + 1)
        .map((row, offset) => ({ row, rowIndex: best.headerIndex + 1 + offset }))
        .filter(({ row }) =>
          best.monthColumns.every(({ index }) => normalizeNumber(row?.[index]) != null),
        )
        .slice(0, 24)
        .map((item, index) => ({ rowIndex: item.rowIndex, hour: index + 1 }));
      hourRows = sequentialRows.length === 24 ? sequentialRows : [];
    }

    return {
      type: hourRows.length === 24 ? "monthly-matrix" : "unknown",
      headerIndex: best.headerIndex,
      monthColumns: best.monthColumns,
      hourRows,
      timeColumn,
    };
  }

  function convertMonthlyMatrixRows(rows, options = {}) {
    const layout = options.layout || detectMonthlyMatrix(rows);
    if (layout.type !== "monthly-matrix") {
      throw new Error("没有识别到月份为列、24小时为行的数据。 ");
    }
    const company = String(options.companyName || DEFAULT_COMPANY_NAME).trim() || DEFAULT_COMPANY_NAME;
    const convertedRows = [["企业名称", "日期", "时点", "电量(MWh)"]];
    for (const monthColumn of layout.monthColumns) {
      for (const hourRow of layout.hourRows) {
        const value = normalizeNumber(rows[hourRow.rowIndex]?.[monthColumn.index]);
        if (value == null) {
          throw new Error(`${monthColumn.month}第${hourRow.hour}小时缺少有效电量。`);
        }
        convertedRows.push([
          company,
          `${monthColumn.month}-01`,
          `${String(hourRow.hour).padStart(2, "0")}:00`,
          value,
        ]);
      }
    }
    return {
      name: options.name || "月度24小时数据（已转换）",
      rows: convertedRows,
      sourceLayout: "monthly-matrix",
      sourceTimeColumnCount: 24,
      sourceMonthCount: layout.monthColumns.length,
      sourceMonths: layout.monthColumns.map((item) => item.month),
    };
  }

  function combineSheets(sources) {
    if (!Array.isArray(sources) || !sources.length) {
      throw new Error("没有可合并的数据文件。");
    }

    const firstAnalysis = analyzeSheet(sources[0].rows);
    const headers = firstAnalysis.headers;
    const combinedRows = [headers.slice()];
    const files = [];

    sources.forEach((source) => {
      const analysis = analyzeSheet(source.rows);
      const sourceHeaderMap = new Map(
        analysis.headers.map((header, index) => [normalizeHeader(header), index]),
      );
      const targetSemanticKeys = headers.map(semanticHeaderKey);
      const sourceSemanticKeys = analysis.headers.map(semanticHeaderKey);
      const countKeys = (keys) =>
        keys.reduce((counts, key) => {
          if (key) counts.set(key, (counts.get(key) || 0) + 1);
          return counts;
        }, new Map());
      const targetSemanticCounts = countKeys(targetSemanticKeys);
      const sourceSemanticCounts = countKeys(sourceSemanticKeys);
      const columnMap = headers.map((header, index) => {
        const exactIndex = sourceHeaderMap.get(normalizeHeader(header));
        if (exactIndex != null) return exactIndex;
        const semanticKey = targetSemanticKeys[index];
        if (
          semanticKey &&
          targetSemanticCounts.get(semanticKey) === 1 &&
          sourceSemanticCounts.get(semanticKey) === 1
        ) {
          return sourceSemanticKeys.indexOf(semanticKey);
        }
        return -1;
      });
      const missingHeaders = headers.filter((_, index) => columnMap[index] < 0);
      let addedRows = 0;

      source.rows.slice(analysis.headerIndex + 1).forEach((row) => {
        if (!row.some((value) => String(value ?? "").trim() !== "")) return;
        combinedRows.push(columnMap.map((sourceIndex) => (sourceIndex >= 0 ? row[sourceIndex] : null)));
        addedRows += 1;
      });

      files.push({
        name: source.name || "未命名文件",
        sheetName: source.sheetName || "",
        addedRows,
        missingHeaders,
      });
    });

    return {
      name: `合并数据（${sources.length} 个文件）`,
      rows: combinedRows,
      files,
    };
  }

  function guessMapping(headers) {
    const normalizedHeaders = headers.map(normalizeHeader);
    const mapping = {};

    for (const [key, names] of Object.entries(HEADER_CANDIDATES)) {
      const normalizedNames = names.map(normalizeHeader);
      let index = normalizedHeaders.findIndex((header) => normalizedNames.includes(header));
      if (index < 0) {
        index = normalizedHeaders.findIndex((header) =>
          normalizedNames.some(
            (name) =>
              name.length >= 3 &&
              header.length >= 3 &&
              (header.includes(name) || name.includes(header)),
          ),
        );
      }
      mapping[key] = index;
    }

    return mapping;
  }

  function getWideTimeColumns(headers) {
    return headers
      .map((header, index) => ({ index, minutes: parseTime(header) }))
      .filter((item) => item.minutes != null)
      .sort((a, b) => a.minutes - b.minutes);
  }

  function detectSourceLayout(headers) {
    const mapping = guessMapping(headers);
    const timeColumns = getWideTimeColumns(headers);
    return {
      type:
        mapping.company >= 0 && mapping.date >= 0 && timeColumns.length >= 24
          ? "wide"
          : "long",
      mapping,
      timeColumns,
    };
  }

  function convertWideRows(rows, options = {}) {
    const headerIndex = options.headerIndex ?? findHeaderRow(rows);
    const headers = (rows[headerIndex] || []).map((value) => String(value ?? "").trim());
    const layout = detectSourceLayout(headers);
    if (layout.type !== "wide") throw new Error("没有识别到横向分时列。");

    const convertedRows = [["企业名称", "日期", "时点", "电量(MWh)"]];
    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      if (!row.some((value) => String(value ?? "").trim() !== "")) continue;
      const company = String(row[layout.mapping.company] ?? "").trim();
      const date = normalizeDate(row[layout.mapping.date]);
      if (!company || !date) continue;
      for (const timeColumn of layout.timeColumns) {
        const value = normalizeNumber(row[timeColumn.index]);
        if (value == null) continue;
        const hours = Math.floor(timeColumn.minutes / 60);
        const minutes = timeColumn.minutes % 60;
        const timeText = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
        convertedRows.push([company, date, timeText, value]);
      }
    }
    return {
      name: options.name || "横向分时数据（已转换）",
      rows: convertedRows,
      sourceLayout: "wide",
      sourceTimeColumnCount: layout.timeColumns.length,
    };
  }

  function normalizeSourceSheet(sheet) {
    const analysis = analyzeSheet(sheet.rows);
    const layout = detectSourceLayout(analysis.headers);
    if (layout.type === "wide") {
      return convertWideRows(sheet.rows, {
        headerIndex: analysis.headerIndex,
        name: `${sheet.name || "工作表"}（横向分时）`,
      });
    }
    const mapping = guessMapping(analysis.headers);
    if (Object.values(mapping).every((columnIndex) => columnIndex >= 0)) {
      return { ...sheet, sourceLayout: "long", sourceTimeColumnCount: 0 };
    }
    const monthlyLayout = detectMonthlyMatrix(sheet.rows);
    if (monthlyLayout.type === "monthly-matrix") {
      return convertMonthlyMatrixRows(sheet.rows, {
        layout: monthlyLayout,
        name: `${sheet.name || "工作表"}（月度24小时）`,
      });
    }
    return { ...sheet, sourceLayout: "long", sourceTimeColumnCount: 0 };
  }

  function normalizeDate(value) {
    const text = String(value ?? "").trim();
    const compactDate = text.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compactDate) {
      const year = Number(compactDate[1]);
      const month = Number(compactDate[2]);
      const day = Number(compactDate[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (
        year >= 1900 &&
        year <= 2200 &&
        date.getUTCFullYear() === year &&
        date.getUTCMonth() + 1 === month &&
        date.getUTCDate() === day
      ) {
        return `${compactDate[1]}-${compactDate[2]}-${compactDate[3]}`;
      }
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
      return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
        .map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, "0")))
        .join("-");
    }

    if (/^\d+(\.\d+)?$/.test(text) && Number(text) > 20000) {
      return normalizeDate(Number(text));
    }

    const match = text.match(/(\d{4})[年\/.\-](\d{1,2})[月\/.\-](\d{1,2})/);
    if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;

    const monthFirst = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
    if (monthFirst) {
      return `${monthFirst[3]}-${monthFirst[1].padStart(2, "0")}-${monthFirst[2].padStart(2, "0")}`;
    }
    return "";
  }

  function parseTime(value) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1.000001) {
      return Math.round(value * 1440);
    }

    const text = String(value ?? "").trim();
    const chineseTime = text.match(/^(\d{1,2})时(?:(\d{1,2})分?)?$/);
    const compactTime = text.match(/^(\d{1,2})(\d{2})$/);
    const match =
      text.match(/(?:^|\s)(\d{1,2})[:：](\d{2})(?::\d{2})?(?:\s|$)/) ||
      (chineseTime ? [chineseTime[0], chineseTime[1], chineseTime[2] || "0"] : null) ||
      (compactTime ? [compactTime[0], compactTime[1], compactTime[2]] : null);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59 || (hours === 24 && minutes !== 0)) {
      return null;
    }
    return hours * 60 + minutes;
  }

  function normalizeNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const text = String(value ?? "").trim().replace(/,/g, "");
    if (!text) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }

  function cleanNumber(value) {
    return value == null ? null : Number(value.toFixed(6));
  }

  function getHourIndex(minutes, intervalMode) {
    if (intervalMode === "end") {
      return Math.min(23, Math.max(0, Math.ceil(minutes / 60) - 1));
    }
    return Math.min(23, Math.max(0, Math.floor(minutes / 60)));
  }

  function processData(rows, mapping, options = {}) {
    const headerIndex = options.headerIndex ?? findHeaderRow(rows);
    const records = [];
    let invalidRows = 0;

    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      if (!row.some((value) => String(value ?? "").trim() !== "")) continue;

      const company = String(row[mapping.company] ?? "").trim();
      const date = normalizeDate(row[mapping.date]);
      const minutes = parseTime(row[mapping.time]);
      const value = normalizeNumber(row[mapping.value]);

      if (!company || !date || minutes == null || value == null) {
        invalidRows += 1;
        continue;
      }

      records.push({ company, date, minutes, value });
    }

    const availableCompanies = [...new Set(records.map((record) => record.company))].sort((a, b) =>
      a.localeCompare(b, "zh-CN"),
    );
    const availableDates = [...new Set(records.map((record) => record.date))].sort();
    const availableMonths = [...new Set(availableDates.map((date) => date.slice(0, 7)))];
    const filteredRecords = records.filter((record) => {
      if (options.companyFilter && record.company !== options.companyFilter) return false;
      if (options.dateStart && record.date < options.dateStart) return false;
      if (options.dateEnd && record.date > options.dateEnd) return false;
      return true;
    });
    const allTimes = new Set(filteredRecords.map((record) => record.minutes));
    const requestedMode = options.intervalMode || "auto";
    const intervalMode = requestedMode === "auto" ? (allTimes.has(1440) ? "end" : "start") : requestedMode;
    const dailyGroups = new Map();
    let inputTotal = 0;

    for (const record of filteredRecords) {
      const key = `${record.company}\u0000${record.date}`;
      if (!dailyGroups.has(key)) {
        dailyGroups.set(key, {
          company: record.company,
          date: record.date,
          sums: Array(24).fill(0),
          counts: Array(24).fill(0),
          timeSlots: new Set(),
        });
      }

      const group = dailyGroups.get(key);
      const hourIndex = getHourIndex(record.minutes, intervalMode);
      group.sums[hourIndex] += record.value;
      group.counts[hourIndex] += 1;
      group.timeSlots.add(record.minutes);
      inputTotal += record.value;
    }

    const dailyRows = [...dailyGroups.values()].sort(
      (a, b) => a.company.localeCompare(b.company, "zh-CN") || a.date.localeCompare(b.date),
    );
    const outputMode = options.outputMode || "daily";
    let resultRows;

    if (outputMode === "daily") {
      resultRows = dailyRows.map((group) => ({
        company: group.company,
        date: group.date,
        hours: group.sums.map((sum, index) => (group.counts[index] ? sum : null)),
      }));
    } else {
      const companies = new Map();
      for (const group of dailyRows) {
        if (!companies.has(group.company)) {
          companies.set(group.company, {
            company: group.company,
            sums: Array(24).fill(0),
            dayCounts: Array(24).fill(0),
          });
        }
        const company = companies.get(group.company);
        group.sums.forEach((sum, hourIndex) => {
          if (group.counts[hourIndex]) {
            company.sums[hourIndex] += sum;
            company.dayCounts[hourIndex] += 1;
          }
        });
      }

      resultRows = [...companies.values()]
        .sort((a, b) => a.company.localeCompare(b.company, "zh-CN"))
        .map((company) => ({
          company: company.company,
          date: "",
          hours: company.sums.map((sum, hourIndex) => {
            if (!company.dayCounts[hourIndex]) return null;
            return outputMode === "average" ? sum / company.dayCounts[hourIndex] : sum;
          }),
        }));
    }

    const includeDate = outputMode === "daily";
    const headers = ["企业名称", ...(includeDate ? ["日期"] : []), ...HOUR_HEADERS, "合计(MWh)"];
    const tableRows = resultRows.map((row) => {
      const hours = row.hours.map(cleanNumber);
      const total = cleanNumber(hours.reduce((sum, value) => sum + (value ?? 0), 0));
      return [row.company, ...(includeDate ? [row.date] : []), ...hours, total];
    });
    const outputTotal = tableRows.reduce(
      (sum, row) => sum + (typeof row[row.length - 1] === "number" ? row[row.length - 1] : 0),
      0,
    );
    const companyCount = new Set(filteredRecords.map((record) => record.company)).size;
    const dates = [...new Set(filteredRecords.map((record) => record.date))].sort();
    const expectedSlots = allTimes.size;
    const incompleteGroups = dailyRows.filter(
      (group) => expectedSlots > 0 && group.timeSlots.size < expectedSlots,
    ).length;

    return {
      headers,
      rows: tableRows,
      meta: {
        sourceRows: Math.max(0, rows.length - headerIndex - 1),
        totalValidRows: records.length,
        validRows: filteredRecords.length,
        invalidRows,
        companyCount,
        dateCount: dates.length,
        dateStart: dates[0] || "",
        dateEnd: dates[dates.length - 1] || "",
        dailyGroupCount: dailyRows.length,
        expectedSlots,
        incompleteGroups,
        intervalMode,
        inputTotal: cleanNumber(inputTotal),
        outputTotal: cleanNumber(outputTotal),
        difference:
          outputMode === "average" ? null : cleanNumber(Math.abs(inputTotal - outputTotal)),
        outputMode,
        availableCompanies,
        availableDates,
        availableMonths,
        selectedDates: dates,
      },
    };
  }

  function buildMonthlySummary(rows, mapping, options = {}) {
    const dailyResult = processData(rows, mapping, {
      ...options,
      outputMode: "daily",
    });
    const groups = new Map();

    for (const row of dailyResult.rows) {
      const company = row[0];
      const month = String(row[1] || "").slice(0, 7);
      if (!company || !month) continue;
      const key = `${company}\u0000${month}`;
      if (!groups.has(key)) {
        groups.set(key, {
          company,
          month,
          sums: Array(24).fill(0),
          counts: Array(24).fill(0),
        });
      }
      const group = groups.get(key);
      row.slice(2, 26).forEach((value, hourIndex) => {
        if (typeof value !== "number") return;
        group.sums[hourIndex] += value;
        group.counts[hourIndex] += 1;
      });
    }

    const monthlyRows = [...groups.values()]
      .sort(
        (a, b) =>
          a.company.localeCompare(b.company, "zh-CN") || a.month.localeCompare(b.month),
      )
      .map((group) => {
        const hours = group.sums.map((sum, index) =>
          group.counts[index] ? cleanNumber(sum) : null,
        );
        const total = cleanNumber(hours.reduce((sum, value) => sum + (value ?? 0), 0));
        return [group.company, group.month, ...hours, total];
      });
    const outputTotal = cleanNumber(
      monthlyRows.reduce((sum, row) => sum + (row[row.length - 1] || 0), 0),
    );
    const selectedMonths = [...new Set(monthlyRows.map((row) => row[1]))];

    return {
      headers: ["企业名称", "月份", ...HOUR_HEADERS, "月合计(MWh)"],
      rows: monthlyRows,
      meta: {
        ...dailyResult.meta,
        outputMode: "monthly",
        companyMonthCount: monthlyRows.length,
        monthCount: selectedMonths.length,
        monthStart: selectedMonths[0] || "",
        monthEnd: selectedMonths[selectedMonths.length - 1] || "",
        selectedMonths,
        selectedCompany: options.companyFilter || monthlyRows[0]?.[0] || "",
        outputTotal,
        difference: cleanNumber(Math.abs((dailyResult.meta.inputTotal || 0) - outputTotal)),
      },
    };
  }

  function transposeMonthlySummary(monthlyResult, options = {}) {
    const months = monthlyResult.rows.map((row) => String(row[1] || ""));
    const decimalPlaces = Number.isInteger(options.decimalPlaces)
      ? Math.min(10, Math.max(0, options.decimalPlaces))
      : null;
    const formatNumber = (value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) return value;
      return decimalPlaces == null ? value : Number(value.toFixed(decimalPlaces));
    };
    const monthColumns = monthlyResult.rows.map((row) => {
      const rawValues = row.slice(2, 26);
      if (decimalPlaces == null) return rawValues.map(formatNumber);
      const factor = 10 ** decimalPlaces;
      const roundedValues = rawValues.map(formatNumber);
      const numericIndexes = rawValues
        .map((value, index) => typeof value === "number" && Number.isFinite(value) ? index : -1)
        .filter((index) => index >= 0);
      if (!numericIndexes.length) return roundedValues;
      const rawTotal = typeof row[row.length - 1] === "number"
        ? row[row.length - 1]
        : rawValues.reduce((sum, value) => sum + (typeof value === "number" ? value : 0), 0);
      const targetUnits = Math.round(rawTotal * factor);
      const currentUnits = numericIndexes.reduce(
        (sum, index) => sum + Math.round(roundedValues[index] * factor),
        0,
      );
      let difference = targetUnits - currentUnits;
      if (difference) {
        const direction = difference > 0 ? 1 : -1;
        const rankedIndexes = [...numericIndexes].sort((left, right) => {
          const leftResidual = rawValues[left] * factor - Math.round(roundedValues[left] * factor);
          const rightResidual = rawValues[right] * factor - Math.round(roundedValues[right] * factor);
          return direction > 0 ? rightResidual - leftResidual : leftResidual - rightResidual;
        });
        let cursor = 0;
        while (difference !== 0 && rankedIndexes.length) {
          const index = rankedIndexes[cursor % rankedIndexes.length];
          const nextUnits = Math.round(roundedValues[index] * factor) + direction;
          if (nextUnits >= 0) {
            roundedValues[index] = Number((nextUnits / factor).toFixed(decimalPlaces));
            difference -= direction;
          }
          cursor += 1;
          if (cursor > rankedIndexes.length * (Math.abs(targetUnits - currentUnits) + 1)) break;
        }
      }
      return roundedValues;
    });
    const rows = HOUR_HEADERS.map((hour, hourIndex) => {
      const monthValues = monthColumns.map((values) => values[hourIndex]);
      const numericValues = monthValues.filter((value) => typeof value === "number");
      const hourlyTotal = numericValues.length
        ? formatNumber(cleanNumber(numericValues.reduce((sum, value) => sum + value, 0)))
        : null;
      return [hour, ...monthValues, hourlyTotal];
    });
    const monthTotals = decimalPlaces == null
      ? monthlyResult.rows.map((row) => row[row.length - 1])
      : monthlyResult.rows.map((row) => formatNumber(row[row.length - 1]));
    const grandTotal = formatNumber(cleanNumber(
      monthTotals.reduce((sum, value) => sum + (typeof value === "number" ? value : 0), 0),
    ));
    rows.push([
      "月合计(MWh)",
      ...monthTotals,
      grandTotal,
    ]);

    return {
      headers: ["时段", ...months, "小时合计(MWh)"],
      rows,
      meta: {
        ...monthlyResult.meta,
        outputMode: "monthly-transposed",
        selectedCompany: monthlyResult.meta.selectedCompany || monthlyResult.rows[0]?.[0] || "",
        ...(decimalPlaces == null ? {} : { decimalPlaces }),
      },
    };
  }

  function quoteCsv(value) {
    if (value == null) return "";
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function toCsv(result) {
    const decimalPlaces = Number.isInteger(result.meta?.decimalPlaces)
      ? Math.min(10, Math.max(0, result.meta.decimalPlaces))
      : null;
    return [result.headers, ...result.rows]
      .map((row) => row.map((value) => {
        if (typeof value === "number" && decimalPlaces != null) {
          return value.toFixed(decimalPlaces);
        }
        return quoteCsv(value);
      }).join(","))
      .join("\r\n");
  }

  function columnName(index) {
    let value = index + 1;
    let name = "";
    while (value > 0) {
      const remainder = (value - 1) % 26;
      name = String.fromCharCode(65 + remainder) + name;
      value = Math.floor((value - 1) / 26);
    }
    return name;
  }

  function makeCell(value, rowIndex, columnIndex, isHeader) {
    if (value == null) return "";
    const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
    if (typeof value === "number") {
      return `<c r="${reference}" s="2" t="n"><v>${value}</v></c>`;
    }
    const style = isHeader ? ' s="1"' : "";
    return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }

  async function toXlsx(result, JSZipCtor) {
    if (!JSZipCtor) throw new Error("缺少 Excel 导出组件。");
    const zip = new JSZipCtor();
    const matrix = [result.headers, ...result.rows];
    const lastColumn = columnName(result.headers.length - 1);
    const lastRow = matrix.length;
    const rowsXml = matrix
      .map((row, rowIndex) => {
        const cells = row
          .map((value, columnIndex) => makeCell(value, rowIndex, columnIndex, rowIndex === 0))
          .join("");
        return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="26" customHeight="1"' : ""}>${cells}</row>`;
      })
      .join("");
    const isTransposedMonthly = result.meta.outputMode === "monthly-transposed";
    const dateColumns = ["daily", "monthly"].includes(result.meta.outputMode) ? 2 : 1;
    const columnsXml = isTransposedMonthly
      ? [
          '<col min="1" max="1" width="18" customWidth="1"/>',
          ...(result.headers.length > 1
            ? [`<col min="2" max="${result.headers.length}" width="15" customWidth="1"/>`]
            : []),
        ].join("")
      : [
          '<col min="1" max="1" width="30" customWidth="1"/>',
          ...(dateColumns === 2 ? ['<col min="2" max="2" width="13" customWidth="1"/>'] : []),
          `<col min="${dateColumns + 1}" max="${result.headers.length - 1}" width="12" customWidth="1"/>`,
          `<col min="${result.headers.length}" max="${result.headers.length}" width="15" customWidth="1"/>`,
        ].join("");
    const topLeftCell = dateColumns === 2 ? "C2" : "B2";
    const createdAt = new Date().toISOString();
    const requestedSheetName = String(result.meta.sheetName || "")
      .replace(/[\\/:*?\[\]]/g, "_")
      .replace(/^'+|'+$/g, "")
      .slice(0, 31);
    const shouldAutoFilter = result.meta.autoFilter !== false && !isTransposedMonthly;
    const decimalPlaces = Number.isInteger(result.meta.decimalPlaces)
      ? Math.min(10, Math.max(0, result.meta.decimalPlaces))
      : 6;
    const numberFormatCode = decimalPlaces === 0 ? "0" : `0.${"0".repeat(decimalPlaces)}`;
    const sheetName = requestedSheetName || (isTransposedMonthly
      ? "月度分时数据"
      : result.meta.outputMode === "monthly"
        ? "月度24小时数据"
        : "24小时分时数据");

    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
        "</Types>",
    );
    zip.file(
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
        "</Relationships>",
    );
    zip.file(
      "docProps/app.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
        '<Application>时能智析 TimeGrid AI</Application></Properties>',
    );
    zip.file(
      "docProps/core.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:creator>MAxd-KD</dc:creator>' +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created></cp:coreProperties>`,
    );
    zip.file(
      "xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<bookViews><workbookView/></bookViews><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>",
    );
    zip.file(
      "xl/styles.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        `<numFmts count="1"><numFmt numFmtId="164" formatCode="${numberFormatCode}"/></numFmts>` +
        '<fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF245C46"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD9E3DD"/></bottom><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        `<dimension ref="A1:${lastColumn}${lastRow}"/>` +
        `<sheetViews><sheetView workbookViewId="0"><pane xSplit="${dateColumns}" ySplit="1" topLeftCell="${topLeftCell}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>` +
        `<cols>${columnsXml}</cols><sheetData>${rowsXml}</sheetData>` +
        `${shouldAutoFilter ? `<autoFilter ref="A1:${lastColumn}${lastRow}"/>` : ""}</worksheet>`,
    );

    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }

  function monthlyChartColor(index) {
    const palette = [
      "245C46",
      "D97706",
      "2563EB",
      "BE123C",
      "7C3AED",
      "0891B2",
      "65A30D",
      "C2410C",
      "4F46E5",
      "A21CAF",
      "0F766E",
      "CA8A04",
    ];
    if (index < palette.length) return palette[index];
    const hue = (index * 137.508 + 205) % 360;
    const saturation = 68;
    const lightness = 44;
    const chroma = (1 - Math.abs((2 * lightness) / 100 - 1)) * (saturation / 100);
    const segment = hue / 60;
    const second = chroma * (1 - Math.abs((segment % 2) - 1));
    const [red, green, blue] =
      segment < 1
        ? [chroma, second, 0]
        : segment < 2
          ? [second, chroma, 0]
          : segment < 3
            ? [0, chroma, second]
            : segment < 4
              ? [0, second, chroma]
              : segment < 5
                ? [second, 0, chroma]
                : [chroma, 0, second];
    const match = lightness / 100 - chroma / 2;
    return [red, green, blue]
      .map((value) => Math.round((value + match) * 255).toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  }

  function chartStringCache(values) {
    return (
      `<c:strCache><c:ptCount val="${values.length}"/>` +
      values
        .map((value, index) => `<c:pt idx="${index}"><c:v>${escapeXml(value)}</c:v></c:pt>`)
        .join("") +
      "</c:strCache>"
    );
  }

  function chartNumberCache(values) {
    return (
      `<c:numCache><c:formatCode>0.000000</c:formatCode><c:ptCount val="${values.length}"/>` +
      values
        .map((value, index) =>
          typeof value === "number" ? `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>` : "",
        )
        .join("") +
      "</c:numCache>"
    );
  }

  function makeMonthlyChartXml(company, entries, chartIndex, sheetName) {
    const categoryFormula = `'${sheetName.replace(/'/g, "''")}'!$C$1:$Z$1`;
    const categories = HOUR_HEADERS;
    const categoryAxisId = 48650112 + chartIndex * 10;
    const valueAxisId = 48672768 + chartIndex * 10;
    const seriesXml = entries
      .map((entry, index) => {
        const rowNumber = entry.rowNumber;
        const values = entry.row.slice(2, 26);
        const valuesFormula = `'${sheetName.replace(/'/g, "''")}'!$C$${rowNumber}:$Z$${rowNumber}`;
        return (
          `<c:ser><c:idx val="${index}"/><c:order val="${index}"/>` +
          `<c:tx><c:v>${escapeXml(entry.month)}</c:v></c:tx>` +
          `<c:spPr><a:ln w="25400"><a:solidFill><a:srgbClr val="${monthlyChartColor(index)}"/></a:solidFill><a:round/></a:ln></c:spPr>` +
          '<c:marker><c:symbol val="none"/></c:marker>' +
          `<c:cat><c:strRef><c:f>${escapeXml(categoryFormula)}</c:f>${chartStringCache(categories)}</c:strRef></c:cat>` +
          `<c:val><c:numRef><c:f>${escapeXml(valuesFormula)}</c:f>${chartNumberCache(values)}</c:numRef></c:val>` +
          '<c:smooth val="0"/></c:ser>'
        );
      })
      .join("");

    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<c:date1904 val="0"/><c:lang val="zh-CN"/><c:roundedCorners val="0"/><c:chart>' +
      `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="zh-CN" sz="1400" b="1"/><a:t>${escapeXml(company)} 月度24小时分时曲线</a:t></a:r><a:endParaRPr lang="zh-CN"/></a:p></c:rich></c:tx><c:layout/><c:overlay val="0"/></c:title>` +
      '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' +
      seriesXml +
      '<c:dLbls><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/></c:dLbls>' +
      `<c:axId val="${categoryAxisId}"/><c:axId val="${valueAxisId}"/></c:lineChart>` +
      `<c:catAx><c:axId val="${categoryAxisId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:tickLblPos val="nextTo"/><c:crossAx val="${valueAxisId}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>` +
      `<c:valAx><c:axId val="${valueAxisId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="0.000" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="${categoryAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>` +
      '</c:plotArea><c:legend><c:legendPos val="t"/><c:layout/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>' +
      '<c:printSettings><c:headerFooter/><c:pageMargins b="0.75" l="0.7" r="0.7" t="0.75" header="0.3" footer="0.3"/><c:pageSetup/></c:printSettings></c:chartSpace>'
    );
  }

  async function toMonthlyXlsx(result, JSZipCtor) {
    if (!JSZipCtor) throw new Error("缺少 Excel 导出组件。");
    const zip = new JSZipCtor();
    const dataSheetName = "月度24小时汇总";
    const chartSheetName = "月度曲线";
    const matrix = [result.headers, ...result.rows];
    const lastColumn = columnName(result.headers.length - 1);
    const lastRow = matrix.length;
    const rowsXml = matrix
      .map((row, rowIndex) => {
        const cells = row
          .map((value, columnIndex) => makeCell(value, rowIndex, columnIndex, rowIndex === 0))
          .join("");
        return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="26" customHeight="1"' : ""}>${cells}</row>`;
      })
      .join("");
    const companyGroups = new Map();
    result.rows.forEach((row, index) => {
      const company = String(row[0] || "");
      if (!companyGroups.has(company)) companyGroups.set(company, []);
      companyGroups.get(company).push({ month: String(row[1] || ""), row, rowNumber: index + 2 });
    });
    const charts = [...companyGroups.entries()];
    const createdAt = new Date().toISOString();
    const chartOverrides = charts
      .map(
        (_, index) =>
          `<Override PartName="/xl/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
      )
      .join("");
    const hasCharts = charts.length > 0;

    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        (hasCharts
          ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
          : "") +
        chartOverrides +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
        "</Types>",
    );
    zip.file(
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
        "</Relationships>",
    );
    zip.file(
      "docProps/app.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
        '<Application>时能智析 TimeGrid AI</Application></Properties>',
    );
    zip.file(
      "docProps/core.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        '<dc:creator>MAxd-KD</dc:creator>' +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created></cp:coreProperties>`,
    );
    zip.file(
      "xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        `<bookViews><workbookView/></bookViews><sheets><sheet name="${dataSheetName}" sheetId="1" r:id="rId1"/><sheet name="${chartSheetName}" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    );
    zip.file(
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>",
    );
    zip.file(
      "xl/styles.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.000000"/></numFmts>' +
        '<fonts count="2"><font><sz val="11"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF245C46"/><bgColor indexed="64"/></patternFill></fill></fills>' +
        '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD9E3DD"/></bottom><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    );
    zip.file(
      "xl/worksheets/sheet1.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        `<dimension ref="A1:${lastColumn}${lastRow}"/>` +
        '<sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>' +
        `<cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="12" customWidth="1"/><col min="3" max="26" width="12" customWidth="1"/><col min="27" max="27" width="15" customWidth="1"/></cols><sheetData>${rowsXml}</sheetData>` +
        `<autoFilter ref="A1:${lastColumn}${lastRow}"/></worksheet>`,
    );

    const chartSheetRows =
      '<row r="1" ht="26" customHeight="1">' +
      makeCell("月度24小时分时曲线", 0, 0, true) +
      '</row><row r="2">' +
      makeCell("每个企业一张图，每条线代表一个月份；对应月份见图例。", 1, 0, false) +
      "</row>";
    zip.file(
      "xl/worksheets/sheet2.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<dimension ref="A1:A2"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><cols><col min="1" max="1" width="72" customWidth="1"/></cols>' +
        `<sheetData>${chartSheetRows}</sheetData>${hasCharts ? '<drawing r:id="rId1"/>' : ""}</worksheet>`,
    );

    if (hasCharts) {
      zip.file(
        "xl/worksheets/_rels/sheet2.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>' +
          "</Relationships>",
      );
      const anchors = charts
        .map((_, index) => {
          const startRow = 3 + index * 21;
          const endRow = startRow + 18;
          return (
            `<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${startRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
            `<xdr:to><xdr:col>15</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${endRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
            `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 2}" name="月度曲线 ${index + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/>` +
            `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${index + 1}"/></a:graphicData></a:graphic>` +
            '</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>'
          );
        })
        .join("");
      zip.file(
        "xl/drawings/drawing1.xml",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
          anchors +
          "</xdr:wsDr>",
      );
      zip.file(
        "xl/drawings/_rels/drawing1.xml.rels",
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          charts
            .map(
              (_, index) =>
                `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${index + 1}.xml"/>`,
            )
            .join("") +
          "</Relationships>",
      );
      charts.forEach(([company, entries], index) => {
        zip.file(
          `xl/charts/chart${index + 1}.xml`,
          makeMonthlyChartXml(company, entries, index, dataSheetName),
        );
      });
    }

    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }

  return {
    HOUR_HEADERS,
    DEFAULT_COMPANY_NAME,
    parseXlsx,
    parseCsv,
    analyzeSheet,
    combineSheets,
    guessMapping,
    normalizeDate,
    parseTime,
    getWideTimeColumns,
    detectSourceLayout,
    normalizeMonth,
    parseMonthlyHour,
    detectMonthlyMatrix,
    convertMonthlyMatrixRows,
    convertWideRows,
    normalizeSourceSheet,
    processData,
    buildMonthlySummary,
    transposeMonthlySummary,
    toCsv,
    toXlsx,
    toMonthlyXlsx,
  };
});
