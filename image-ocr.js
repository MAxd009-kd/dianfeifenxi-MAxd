(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ImageTableParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  const DEFAULT_COMPANY_NAME = "电力用户";
  const IMAGE_MONTH_YEAR = "2000";
  let workerPromise = null;
  let progressListener = null;

  function normalizeMonth(year, month) {
    const numericYear = Number(year);
    const numericMonth = Number(month);
    if (numericYear < 2000 || numericYear > 2200 || numericMonth < 1 || numericMonth > 12) return "";
    return `${numericYear}-${String(numericMonth).padStart(2, "0")}`;
  }

  function extractMonths(line, fallbackYear = "") {
    const normalized = String(line || "").replace(/[—–－]/g, "-");
    const months = [];
    const add = (value) => {
      if (value && !months.includes(value)) months.push(value);
    };
    let match;
    const fullPattern = /(20\d{2})\s*[年\/.\-]\s*(0?[1-9]|1[0-2])\s*月?/g;
    while ((match = fullPattern.exec(normalized))) add(normalizeMonth(match[1], match[2]));
    const compactPattern = /(?:^|\D)(20\d{2})(0[1-9]|1[0-2])(?:\D|$)/g;
    while ((match = compactPattern.exec(normalized))) add(normalizeMonth(match[1], match[2]));
    if (!months.length && /^20\d{2}$/.test(String(fallbackYear))) {
      const monthPattern = /(?:^|\D)(0?[1-9]|1[0-2])\s*月(?:\D|$)/g;
      while ((match = monthPattern.exec(normalized))) add(normalizeMonth(fallbackYear, match[1]));
    }
    return months;
  }

  function toImageMonth(month) {
    const match = String(month || "").match(/(?:^|-)(0?[1-9]|1[0-2])$/);
    return match ? `${IMAGE_MONTH_YEAR}-${match[1].padStart(2, "0")}` : "";
  }

  function extractImageMonths(line) {
    const text = String(line || "").replace(/[—–－]/g, "-");
    const found = [];
    let match;
    const fullPattern = /(20\d{2})\s*[年\/.\-]\s*(0?[1-9]|1[0-2])\s*月?/g;
    while ((match = fullPattern.exec(text))) found.push({ index: match.index, month: match[2] });
    const compactPattern = /(?:^|\D)(20\d{2})(0[1-9]|1[0-2])(?:\D|$)/g;
    while ((match = compactPattern.exec(text))) {
      found.push({ index: match.index + match[0].indexOf(match[1]), month: match[2] });
    }
    const monthOnlyPattern = /(?<!\d)(0?[1-9]|1[0-2])\s*月(?!\d)/g;
    while ((match = monthOnlyPattern.exec(text))) {
      found.push({ index: match.index, month: match[1] });
    }
    const months = [];
    found.sort((left, right) => left.index - right.index).forEach(({ month }) => {
      const normalized = toImageMonth(month);
      if (normalized && !months.includes(normalized)) months.push(normalized);
    });
    return months;
  }

  function extractNumbers(line) {
    return [...String(line || "").replace(/,/g, "").matchAll(/-?(?:\d+\.\d+|\d+)/g)]
      .map((match) => Number(match[0]))
      .filter(Number.isFinite);
  }

  function closeEnough(left, right) {
    const tolerance = Math.max(0.16, Math.abs(right) * 0.004);
    return Math.abs(left - right) <= tolerance;
  }

  function splitValues(numbers, monthCount, hasRowTotal) {
    if (numbers.length < monthCount) return null;
    if (hasRowTotal) {
      if (numbers.length < monthCount + 1) return null;
      const suffix = numbers.slice(-(monthCount + 1));
      const values = suffix.slice(0, monthCount);
      const reportedTotal = suffix[monthCount];
      const calculatedTotal = values.reduce((sum, value) => sum + value, 0);
      if (!closeEnough(calculatedTotal, reportedTotal)) return null;
      return { values, reportedTotal };
    }
    return { values: numbers.slice(-monthCount), reportedTotal: null };
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function parseTsvWords(tsv) {
    const lines = String(tsv || "").split(/\r?\n/);
    if (!lines.length) return [];
    const headers = lines[0].split("\t");
    const hasHeader = headers.includes("level") && headers.includes("left") && headers.includes("text");
    const indexes = hasHeader ? {
      level: headers.indexOf("level"),
      page: headers.indexOf("page_num"),
      block: headers.indexOf("block_num"),
      paragraph: headers.indexOf("par_num"),
      line: headers.indexOf("line_num"),
      word: headers.indexOf("word_num"),
      left: headers.indexOf("left"),
      top: headers.indexOf("top"),
      width: headers.indexOf("width"),
      height: headers.indexOf("height"),
      confidence: headers.indexOf("conf"),
      text: headers.indexOf("text"),
    } : {
      level: 0,
      page: 1,
      block: 2,
      paragraph: 3,
      line: 4,
      word: 5,
      left: 6,
      top: 7,
      width: 8,
      height: 9,
      confidence: 10,
      text: 11,
    };
    const dataLines = hasHeader ? lines.slice(1) : lines;
    return dataLines.map((line) => {
      const cells = line.split("\t");
      const left = Number(cells[indexes.left]);
      const top = Number(cells[indexes.top]);
      const width = Number(cells[indexes.width]);
      const height = Number(cells[indexes.height]);
      const text = String(cells.slice(indexes.text).join("\t") || "").trim();
      return {
        level: Number(cells[indexes.level] || 0),
        page: Number(cells[indexes.page] || 0),
        block: Number(cells[indexes.block] || 0),
        paragraph: Number(cells[indexes.paragraph] || 0),
        line: Number(cells[indexes.line] || 0),
        word: Number(cells[indexes.word] || 0),
        left,
        top,
        width,
        height,
        right: left + width,
        bottom: top + height,
        centerX: left + width / 2,
        centerY: top + height / 2,
        confidence: Number(cells[indexes.confidence] || 0),
        text,
      };
    }).filter((word) => word.text && [word.left, word.top, word.width, word.height].every(Number.isFinite));
  }

  function findMonthHeaders(words) {
    const direct = [];
    words.forEach((word) => {
      extractImageMonths(word.text).forEach((month) => direct.push({ ...word, month }));
    });

    const lineGroups = new Map();
    words.forEach((word) => {
      const key = `${word.page}:${word.block}:${word.paragraph}:${word.line}`;
      if (!lineGroups.has(key)) lineGroups.set(key, []);
      lineGroups.get(key).push(word);
    });
    lineGroups.forEach((lineWords) => {
      const sorted = lineWords.sort((left, right) => left.left - right.left);
      for (let start = 0; start < sorted.length; start += 1) {
        for (let size = 2; size <= 3 && start + size <= sorted.length; size += 1) {
          const segment = sorted.slice(start, start + size);
          const joined = segment.map((word) => word.text).join("");
          extractImageMonths(joined).forEach((month) => direct.push({
            ...segment[0],
            month,
            left: segment[0].left,
            right: segment.at(-1).right,
            width: segment.at(-1).right - segment[0].left,
            centerX: (segment[0].left + segment.at(-1).right) / 2,
            centerY: median(segment.map((word) => word.centerY)),
            height: Math.max(...segment.map((word) => word.height)),
          }));
        }
      }
    });

    if (!direct.length) {
      const imageRight = Math.max(...words.map((word) => word.right));
      const imageBottom = Math.max(...words.map((word) => word.bottom));
      const topCandidates = words.filter((word) => {
        const value = strictNumber(word.text);
        return Number.isInteger(value) && value >= 1 && value <= 12
          && word.centerX > imageRight * 0.15
          && word.centerY < imageBottom * 0.22;
      });
      const height = median(topCandidates.map((word) => word.height)) || 16;
      const clusters = [];
      topCandidates.sort((left, right) => left.centerY - right.centerY || left.centerX - right.centerX).forEach((candidate) => {
        let cluster = clusters.find((item) => Math.abs(item.centerY - candidate.centerY) <= Math.max(8, height));
        if (!cluster) {
          cluster = { centerY: candidate.centerY, items: [] };
          clusters.push(cluster);
        }
        cluster.items.push(candidate);
        cluster.centerY = median(cluster.items.map((item) => item.centerY));
      });
      const numericHeader = clusters.sort((left, right) => right.items.length - left.items.length || left.centerY - right.centerY)[0];
      if (numericHeader) {
        numericHeader.items.forEach((word) => {
          const month = toImageMonth(strictNumber(word.text));
          if (month) direct.push({ ...word, month });
        });
      }
    }
    if (!direct.length) return [];

    const height = median(direct.map((word) => word.height)) || 16;
    const clusters = [];
    direct.sort((left, right) => left.centerY - right.centerY || left.centerX - right.centerX).forEach((candidate) => {
      let cluster = clusters.find((item) => Math.abs(item.centerY - candidate.centerY) <= Math.max(10, height * 1.5));
      if (!cluster) {
        cluster = { centerY: candidate.centerY, items: [] };
        clusters.push(cluster);
      }
      cluster.items.push(candidate);
      cluster.centerY = median(cluster.items.map((item) => item.centerY));
    });
    const best = clusters.sort((left, right) => {
      const leftUnique = new Set(left.items.map((item) => item.month)).size;
      const rightUnique = new Set(right.items.map((item) => item.month)).size;
      return rightUnique - leftUnique || left.centerY - right.centerY;
    })[0];
    const unique = new Map();
    best.items.sort((left, right) => left.centerX - right.centerX).forEach((item) => {
      if (!unique.has(item.month)) unique.set(item.month, item);
    });
    return [...unique.values()].sort((left, right) => left.centerX - right.centerX);
  }

  function strictNumber(text) {
    const normalized = String(text || "").replace(/,/g, "").trim();
    if (!/^-?(?:\d+\.\d+|\d+)$/.test(normalized)) return null;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  }

  function parseOcrTsv(tsv, text = "", fileName = "图片") {
    const words = parseTsvWords(tsv);
    if (!words.length) return null;
    const headers = findMonthHeaders(words);
    if (!headers.length) return null;

    const detectedMonths = headers.map((header) => header.month);
    const headerY = median(headers.map((header) => header.centerY));
    const wordHeight = median(words.map((word) => word.height)) || 16;
    const imageRight = Math.max(...words.map((word) => word.right));
    const gaps = headers.slice(1).map((header, index) => header.centerX - headers[index].centerX).filter((gap) => gap > 0);
    const typicalGap = median(gaps) || Math.max(100, imageRight * 0.22);
    const boundaries = headers.map((header, index) => ({
      left: index ? (headers[index - 1].centerX + header.centerX) / 2 : header.centerX - typicalGap / 2,
      right: index < headers.length - 1
        ? (header.centerX + headers[index + 1].centerX) / 2
        : header.centerX + typicalGap / 2,
    }));
    const numericWords = words.map((word) => ({ ...word, value: strictNumber(word.text) }))
      .filter((word) => word.value !== null && word.value >= 0 && word.centerY > headerY + wordHeight * 1.15)
      .filter((word) => boundaries.some((boundary) => word.centerX >= boundary.left && word.centerX < boundary.right));

    const rowTolerance = Math.max(7, wordHeight * 0.7);
    const rowGroups = [];
    numericWords.sort((left, right) => left.centerY - right.centerY || left.centerX - right.centerX).forEach((word) => {
      let row = rowGroups.find((candidate) => Math.abs(candidate.centerY - word.centerY) <= rowTolerance);
      if (!row) {
        row = { centerY: word.centerY, words: [] };
        rowGroups.push(row);
      }
      row.words.push(word);
      row.centerY = median(row.words.map((item) => item.centerY));
    });

    const completeRows = rowGroups.map((row) => {
      const values = headers.map((header, monthIndex) => {
        const boundary = boundaries[monthIndex];
        const matches = row.words.filter((word) => word.centerX >= boundary.left && word.centerX < boundary.right);
        if (!matches.length) return null;
        matches.sort((left, right) => Math.abs(left.centerX - header.centerX) - Math.abs(right.centerX - header.centerX));
        return matches[0].value;
      });
      return { centerY: row.centerY, values };
    }).filter((row) => row.values.every((value) => value !== null));

    if (completeRows.length < 24) {
      const error = new Error(`图片坐标表格检测到 ${detectedMonths.length} 个月，但只还原出 ${completeRows.length}/24 行完整数据，请上传清晰且未裁掉表头或数据行的截图。`);
      error.detectedMonthCount = detectedMonths.length;
      throw error;
    }

    const hourlyRows = completeRows.slice(0, 24);
    const dataRows = hourlyRows.map((row, index) => [
      `${String(index + 1).padStart(2, "0")}时`,
      ...row.values,
    ]);
    const calculatedMonthTotals = detectedMonths.map((_, monthIndex) =>
      dataRows.reduce((sum, row) => sum + Number(row[monthIndex + 1] || 0), 0),
    );
    const reportedTotalRow = completeRows.slice(24).find((row) =>
      row.values.every((value, index) => closeEnough(value, calculatedMonthTotals[index])),
    );
    const warnings = reportedTotalRow ? [] : ["图片未识别到可核对的月合计行，已按24小时数据自行汇总。"];

    return {
      rows: [["时段", ...detectedMonths], ...dataRows],
      months: detectedMonths,
      warnings,
      company: DEFAULT_COMPANY_NAME,
      hasRowTotal: false,
      layout: "coordinates",
    };
  }

  function parseColumnOrientedText(lines) {
    const monthMarkers = [];
    lines.forEach((line, lineIndex) => {
      const found = extractImageMonths(line);
      if (found.length === 1 && !monthMarkers.some((marker) => marker.month === found[0])) {
        monthMarkers.push({ month: found[0], lineIndex });
      }
    });
    if (monthMarkers.length < 2) return null;

    const columns = monthMarkers.map((marker, index) => {
      const end = monthMarkers[index + 1]?.lineIndex ?? lines.length;
      const values = [];
      for (const line of lines.slice(marker.lineIndex + 1, end)) {
        const numbers = extractNumbers(line);
        if (numbers.length !== 1 || numbers[0] < 0) continue;
        values.push(numbers[0]);
      }
      return { ...marker, values };
    });
    if (columns.some((column) => column.values.length < 24)) return null;

    const dataRows = Array.from({ length: 24 }, (_, hourIndex) => [
      `${String(hourIndex + 1).padStart(2, "0")}时`,
      ...columns.map((column) => column.values[hourIndex]),
    ]);
    const warnings = [];
    columns.forEach((column) => {
      const calculated = column.values.slice(0, 24).reduce((sum, value) => sum + value, 0);
      const reported = column.values[24];
      if (!Number.isFinite(reported) || !closeEnough(calculated, reported)) {
        warnings.push("图片未识别到可核对的月合计行，已按24小时数据自行汇总。");
      }
    });
    return {
      rows: [["时段", ...columns.map((column) => column.month)], ...dataRows],
      months: columns.map((column) => column.month),
      warnings: [...new Set(warnings)],
      company: DEFAULT_COMPANY_NAME,
      hasRowTotal: false,
      layout: "column-text",
    };
  }

  function parseOcrText(text, fileName = "图片") {
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const columnOriented = parseColumnOrientedText(lines);
    if (columnOriented) return columnOriented;
    let headerIndex = -1;
    let months = [];
    lines.forEach((line, index) => {
      const found = extractImageMonths(line);
      if (found.length > months.length) {
        months = found;
        headerIndex = index;
      }
    });
    if (!months.length) {
      months = extractImageMonths(fileName);
      headerIndex = -1;
    }
    if (!months.length) {
      throw new Error("图片中未识别到月份，请在表头标注“1月”“01月”或“YYYY-MM”。");
    }

    const candidates = lines.slice(headerIndex + 1).map((line, index) => ({
      line,
      lineIndex: headerIndex + 1 + index,
      numbers: extractNumbers(line),
    }));
    const totalMatches = candidates.slice(0, 32).filter(({ numbers }) => {
      if (numbers.length < months.length + 1) return false;
      const suffix = numbers.slice(-(months.length + 1));
      return closeEnough(
        suffix.slice(0, months.length).reduce((sum, value) => sum + value, 0),
        suffix[months.length],
      );
    }).length;
    const hasRowTotal = totalMatches >= Math.min(8, Math.max(3, Math.floor(months.length * 1.5)));
    const dataRows = [];
    let lastLineIndex = headerIndex;
    for (const candidate of candidates) {
      if (dataRows.length >= 24) break;
      const parsed = splitValues(candidate.numbers, months.length, hasRowTotal);
      if (!parsed || parsed.values.some((value) => value < 0)) continue;
      dataRows.push([`${String(dataRows.length + 1).padStart(2, "0")}时`, ...parsed.values]);
      lastLineIndex = candidate.lineIndex;
    }
    if (dataRows.length !== 24) {
      throw new Error(`图片只识别到 ${dataRows.length}/24 行分时数据，请上传完整、清晰且未倾斜的表格截图。`);
    }

    const warnings = [];
    const calculatedMonthTotals = months.map((_, monthIndex) =>
      dataRows.reduce((sum, row) => sum + Number(row[monthIndex + 1] || 0), 0),
    );
    const totalLine = lines.slice(lastLineIndex + 1).find((line) => {
      const numbers = extractNumbers(line);
      if (numbers.length < months.length) return false;
      const suffix = numbers.length >= months.length + 1
        ? numbers.slice(-(months.length + 1))
        : numbers.slice(-months.length);
      const possibleTotals = suffix.length === months.length + 1 ? suffix.slice(0, -1) : suffix;
      return possibleTotals.every((value, index) => closeEnough(value, calculatedMonthTotals[index]));
    });
    if (!totalLine) warnings.push("图片未识别到可核对的月合计行，已按24小时数据自行汇总。");

    return {
      rows: [["时段", ...months], ...dataRows],
      months,
      warnings,
      company: DEFAULT_COMPANY_NAME,
      hasRowTotal,
    };
  }

  async function prepareImage(file) {
    let bitmap;
    let release = () => {};
    if (typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(file);
      release = () => bitmap.close?.();
    } else {
      const objectUrl = URL.createObjectURL(file);
      bitmap = new Image();
      await new Promise((resolve, reject) => {
        bitmap.onload = resolve;
        bitmap.onerror = () => reject(new Error("无法读取图片内容。"));
        bitmap.src = objectUrl;
      });
      release = () => URL.revokeObjectURL(objectUrl);
    }
    const width = bitmap.width || bitmap.naturalWidth;
    const height = bitmap.height || bitmap.naturalHeight;
    const minimumWidthScale = width < 1800 ? 1800 / width : 1;
    const maximumScale = 3000 / Math.max(width, height);
    const scale = Math.min(2, Math.max(1, minimumWidthScale), maximumScale);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.filter = "grayscale(1) contrast(1.2)";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    release();
    return canvas;
  }

  function getWorker(onProgress) {
    if (!root.Tesseract) throw new Error("图片识别组件未加载，请刷新页面后重试。");
    progressListener = onProgress;
    if (!workerPromise) {
      workerPromise = root.Tesseract.createWorker("eng", 1, {
        workerPath: "./ocr/worker.min.js",
        corePath: "./ocr/tesseract-core-lstm.wasm.js",
        langPath: "./ocr",
        gzip: false,
        logger: (message) => {
          if (typeof progressListener === "function") progressListener(message);
        },
      }).then(async (worker) => {
        await worker.setParameters({
          tessedit_pageseg_mode: root.Tesseract.PSM.SPARSE_TEXT,
          tessedit_char_whitelist: "0123456789.- ",
          preserve_interword_spaces: "1",
        });
        return worker;
      }).catch((error) => {
        workerPromise = null;
        throw error;
      });
    }
    return workerPromise;
  }

  async function parse(file, onProgress) {
    progressListener = onProgress;
    const worker = await getWorker(onProgress);
    const image = await prepareImage(file);
    const recognition = await worker.recognize(image, {}, { text: true, tsv: true });
    let parsed;
    let coordinateError = null;
    try {
      parsed = parseOcrTsv(recognition.data.tsv, recognition.data.text, file.name);
    } catch (error) {
      coordinateError = error;
    }
    if (!parsed) {
      const textParsed = parseOcrText(recognition.data.text, file.name);
      if (coordinateError?.detectedMonthCount > textParsed.months.length) throw coordinateError;
      parsed = textParsed;
    }
    return {
      workbook: {
        type: "image",
        sheets: [{ name: "图片识别结果", rows: parsed.rows }],
      },
      image: {
        months: parsed.months,
        warnings: parsed.warnings,
        confidence: Number(recognition.data.confidence || 0),
        layout: parsed.layout || "text",
      },
    };
  }

  return {
    DEFAULT_COMPANY_NAME,
    IMAGE_MONTH_YEAR,
    extractMonths,
    extractImageMonths,
    extractNumbers,
    parseTsvWords,
    findMonthHeaders,
    parseOcrTsv,
    parseColumnOrientedText,
    parseOcrText,
    parse,
  };
});
