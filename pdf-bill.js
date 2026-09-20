(function (root, factory) {
  const api = factory(root.pdfjsLib, root.TouPriceData);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.PdfBillParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (pdfjsLib, defaultTouData) {
  "use strict";

  const LOAD_PROFILES = {
    noonValley: {
      label: "中午低谷型",
      description: "上午、下午或晚间负荷较高，中午时段明显回落",
      weights: [0.45,0.42,0.40,0.40,0.42,0.48,0.62,0.82,1.04,1.18,1.12,0.82,0.48,0.52,0.84,1.08,1.18,1.16,1.06,0.92,0.78,0.66,0.56,0.49],
    },
    noonNightWork: {
      label: "中午夜间工作型",
      description: "中午与夜间持续作业，早间负荷相对较低",
      weights: [0.92,0.88,0.82,0.76,0.68,0.58,0.50,0.48,0.56,0.72,0.94,1.14,1.22,1.18,1.04,0.90,0.86,0.94,1.08,1.20,1.26,1.22,1.12,1.00],
    },
    noonPeak: {
      label: "中午高峰型",
      description: "负荷在中午前后形成主要高峰，早晚相对较低",
      weights: [0.22,0.20,0.19,0.19,0.21,0.26,0.38,0.56,0.78,1.00,1.18,1.30,1.34,1.30,1.20,1.04,0.84,0.66,0.50,0.40,0.34,0.30,0.27,0.24],
    },
    allDayAverage: {
      label: "全天平均型",
      description: "全天均有稳定负荷，仅随生产节奏出现小幅波动",
      weights: [0.94,0.92,0.91,0.90,0.92,0.95,0.98,1.01,1.04,1.06,1.05,1.02,0.99,1.00,1.02,1.04,1.06,1.08,1.07,1.05,1.02,0.99,0.97,0.95],
    },
    earlyMorningWork: {
      label: "凌晨工作型",
      description: "凌晨至清晨负荷集中，白天逐步回落",
      weights: [1.24,1.30,1.34,1.32,1.24,1.12,0.94,0.74,0.58,0.48,0.42,0.38,0.36,0.36,0.38,0.42,0.48,0.56,0.66,0.78,0.92,1.04,1.14,1.20],
    },
    doublePeak: {
      label: "双峰型",
      description: "早间和晚间各形成一次明显高峰，中间时段回落",
      weights: [0.42,0.40,0.39,0.40,0.45,0.58,0.82,1.12,1.28,1.18,0.92,0.72,0.62,0.66,0.78,0.96,1.16,1.30,1.34,1.20,0.96,0.72,0.56,0.47],
    },
    morningPeak: {
      label: "早高峰型",
      description: "清晨至上午负荷快速抬升并形成主要高峰",
      weights: [0.38,0.36,0.35,0.36,0.42,0.58,0.82,1.10,1.30,1.34,1.22,1.02,0.84,0.72,0.64,0.58,0.54,0.52,0.50,0.48,0.46,0.44,0.42,0.40],
    },
    eveningPeak: {
      label: "晚高峰型",
      description: "下午后负荷逐步升高，在傍晚至夜间形成主要高峰",
      weights: [0.36,0.34,0.33,0.33,0.35,0.38,0.42,0.48,0.54,0.60,0.66,0.72,0.78,0.84,0.92,1.02,1.14,1.26,1.34,1.32,1.20,1.02,0.78,0.54],
    },
    straight: {
      label: "直线型",
      description: "24小时负荷完全等权分布，用于缺少明显时段特征的场景",
      weights: Array(24).fill(1),
    },
  };

  const BAND_FIELDS = {
    S: "sharpKwh",
    H: "peakKwh",
    P: "flatKwh",
    V: "valleyKwh",
  };
  const BAND_LABELS = { S: "尖峰", H: "峰", P: "平", V: "谷" };
  const MIN_SUPPORTED_BILL_YEAR = 2026;
  const PROFILE_INFLUENCE = 0.45;
  const MAX_BAND_DEVIATION = 0.2;
  const NEIGHBOR_SMOOTHING_WEIGHT = 0.18;
  const PROFILE_ANCHOR_WEIGHT = 0.72;
  const SMOOTHING_ITERATIONS = 8;
  const MAX_BAND_TOTAL_MISMATCH_RATIO = 0.01;

  function finiteNumber(value) {
    const parsed = Number(String(value ?? "").replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function compactCompany(value) {
    return String(value || "")
      .replace(/[\s*：:]+/g, "")
      .replace(/受电点.*$/, "")
      .trim();
  }

  function extractDates(text) {
    const dates = [];
    const pattern = /([12]\s*\d\s*\d\s*\d)\s*[-/.年]\s*(\d\s*\d|\d)\s*[-/.月]\s*(\d\s*\d|\d)\s*日?/g;
    for (const match of text.matchAll(pattern)) {
      const year = match[1].replace(/\s/g, "");
      const month = match[2].replace(/\s/g, "").padStart(2, "0");
      const day = match[3].replace(/\s/g, "").padStart(2, "0");
      const date = `${year}-${month}-${day}`;
      if (!dates.includes(date)) dates.push(date);
    }
    return dates;
  }

  function numbersIn(value) {
    return (String(value || "").match(/-?\d+(?:\.\d+)?/g) || []).map(Number).filter(Number.isFinite);
  }

  function segmentLastNumber(text, label, nextLabels) {
    const start = text.indexOf(label);
    if (start < 0) return null;
    let end = text.length;
    nextLabels.forEach((nextLabel) => {
      const next = text.indexOf(nextLabel, start + label.length);
      if (next >= 0 && next < end) end = next;
    });
    const values = numbersIn(text.slice(start + label.length, end));
    return values.length ? values.at(-1) : null;
  }

  function extractRatioValues(text) {
    const start = text.indexOf("本期您用电的峰谷分时比例为");
    if (start < 0) return [];
    const segment = text.slice(start, start + 180).replace(/(\d)\s+(?=\d)/g, "$1");
    return [...segment.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((match) => Number(match[1])).slice(0, 4);
  }

  function normalizedBandShares(values) {
    const codes = Object.keys(BAND_FIELDS);
    const totals = codes.map((code) => Math.max(0, finiteNumber(values?.[code])));
    const sum = totals.reduce((total, value) => total + value, 0);
    return sum > 0 ? Object.fromEntries(codes.map((code, index) => [code, totals[index] / sum])) : null;
  }

  function profileBandShares(profile, bandCode) {
    if (!profile || !bandCode || bandCode.length < 24) return null;
    const totals = { S: 0, H: 0, P: 0, V: 0 };
    [...bandCode].slice(0, 24).forEach((code, hourIndex) => {
      if (code in totals) totals[code] += Math.max(0, finiteNumber(profile.weights[hourIndex]));
    });
    return normalizedBandShares(totals);
  }

  function bandShareSimilarity(observed, expected) {
    if (!observed || !expected) return 0;
    const distance = Object.keys(BAND_FIELDS).reduce(
      (sum, code) => sum + Math.abs((observed[code] || 0) - (expected[code] || 0)),
      0,
    );
    return Math.max(0, 1 - distance / 2);
  }

  function inferLoadType(company, category, context = {}, touData = defaultTouData) {
    const text = `${company} ${category}`;
    const monthMatch = String(context.month || "").match(/-(\d{2})$/);
    const monthIndex = monthMatch ? Number(monthMatch[1]) - 1 : -1;
    const bandCode = monthIndex >= 0 ? touData?.bandCodes?.[monthIndex] : null;
    const observedShares = normalizedBandShares(context.bandTotals);
    const scores = Object.fromEntries(Object.keys(LOAD_PROFILES).map((key) => [key, 0]));
    const reasons = [];
    const addTextScore = (profileKey, pattern, score, reason) => {
      if (!pattern.test(text)) return;
      scores[profileKey] += score;
      reasons.push(reason);
    };

    addTextScore("earlyMorningWork", /充电|换电|充换电|夜班|夜间/, 7, "夜间作业特征");
    addTextScore("eveningPeak", /餐饮|饭店|餐厅|娱乐|影院|酒吧|夜市/, 7, "晚间营业特征");
    addTextScore("doublePeak", /酒店|宾馆|旅馆|住宿|公寓|供水|水务|自来水|泵站/, 6, "早晚双峰特征");
    addTextScore("morningPeak", /学校|学院|大学|办公|政务|机关|写字楼|早餐/, 7, "早间工作特征");
    addTextScore("noonPeak", /商场|超市|百货|购物|会展|商业综合体|空调/, 6, "日间营业特征");
    addTextScore("noonValley", /制造|机械|加工|锻造|铸造|法兰|汽车零部件|装备制造|食品|纺织|印刷|家具|电子|服装/, 6, "生产与午间换班特征");
    addTextScore("noonNightWork", /仓储|物流|配送|快递|冷库|冷链|制冷|冷藏|恒温/, 6, "中午及夜间连续作业特征");
    addTextScore("allDayAverage", /化工|焦化|冶炼|水泥|钙业|钢铁|玻璃|造纸|轮胎|能源|材料|医院|医疗|卫生院|养殖/, 7, "连续负荷特征");

    if (observedShares && bandCode) {
      Object.entries(LOAD_PROFILES).forEach(([profileKey, profile]) => {
        scores[profileKey] += bandShareSimilarity(observedShares, profileBandShares(profile, bandCode)) * 3;
      });
      const valleyShare = observedShares.V || 0;
      const sharpPeakShare = (observedShares.S || 0) + (observedShares.H || 0);
      if (valleyShare >= 0.42) {
        scores.earlyMorningWork += 1.4;
        scores.noonNightWork += 0.8;
        scores.allDayAverage += 0.4;
      }
      if (sharpPeakShare >= 0.55) {
        scores.morningPeak += 0.4;
        scores.noonPeak += 0.4;
        scores.eveningPeak += 0.4;
        scores.doublePeak += 0.4;
      }
      const shares = Object.values(observedShares);
      const spread = Math.max(...shares) - Math.min(...shares);
      if (spread <= 0.18) scores.allDayAverage += 0.8;
    }

    scores.straight += 0.25;
    scores.allDayAverage += 0.2;
    const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]);
    const selected = ranked[0]?.[0] || "straight";
    const confidenceGap = (ranked[0]?.[1] || 0) - (ranked[1]?.[1] || 0);
    if (!reasons.length && (!observedShares || confidenceGap < 0.35)) return "straight";
    return selected;
  }

  function yearFromMonth(month) {
    const match = String(month || "").match(/^(\d{4})-(\d{2})$/);
    return match ? Number(match[1]) : null;
  }

  function validateCompleteMonth(record) {
    const monthMatch = String(record.month || "").match(/^(\d{4})-(\d{2})$/);
    if (!monthMatch) throw new Error("未识别正确的账单月份。");
    const year = Number(monthMatch[1]);
    const monthNumber = Number(monthMatch[2]);
    const month = `${year}-${String(monthNumber).padStart(2, "0")}`;
    const expectedStart = `${month}-01`;
    const lastDay = new Date(year, monthNumber, 0).getDate();
    const expectedEnd = `${month}-${String(lastDay).padStart(2, "0")}`;
    if (record.periodStart !== expectedStart || record.periodEnd !== expectedEnd) {
      const actual = record.periodStart && record.periodEnd
        ? `${record.periodStart}至${record.periodEnd}`
        : "未完整识别";
      throw new Error(`仅支持完整自然月电费单；${month}应覆盖${expectedStart}至${expectedEnd}，当前账单周期为${actual}。`);
    }
    return { year, monthNumber, expectedStart, expectedEnd };
  }

  function validateSupportedYear(record, touData = defaultTouData) {
    const billYear = yearFromMonth(record.month);
    const supportedYear = Number(touData?.analysisYear) || null;
    if (!billYear) throw new Error("请选择正确的账单月份。");
    if (billYear < MIN_SUPPORTED_BILL_YEAR && !touData?.allowHistoricalTraining) throw new Error(`仅支持${MIN_SUPPORTED_BILL_YEAR}年及以后账单；${MIN_SUPPORTED_BILL_YEAR}年以前账单只用于识别规则验证，不参与正式分析。`);
    if (!supportedYear || billYear !== supportedYear) {
      throw new Error(`当前内置国网峰平谷时段为${supportedYear || "未知"}年，尚不能直接分析${billYear}年账单，请先更新对应年度国网时段数据。`);
    }
    return { billYear, supportedYear };
  }

  function parseBillText(text, fileName = "电费账单.pdf") {
    const normalized = String(text || "").replace(/\u00a0/g, " ").replace(/[\t\r]+/g, " ");
    const dates = extractDates(normalized);
    const companyMatch = normalized.match(/户名\s+(.+?)\s+供电服务单位/)
      || normalized.match(/受电点[:：]\s*(.+?)受电点/);
    const company = compactCompany(companyMatch?.[1]) || fileName.replace(/\.pdf$/i, "");
    const categoryMatch = normalized.match(/电价[:：]\s*([^\n]+?)(?=电量明细|正向有功|$)/);
    const category = String(categoryMatch?.[1] || "").replace(/\s+/g, "").trim();
    const totalMatch = normalized.match(/本期电量\s+([\d,.]+)\s*千瓦时/);
    const totalFromRows = segmentLastNumber(normalized, "正向有功（总）", ["正向无功（总）", "电费明细"]);
    let totalKwh = totalMatch ? finiteNumber(totalMatch[1]) : finiteNumber(totalFromRows);
    let sharpKwh = finiteNumber(segmentLastNumber(normalized, "正向有功（尖峰）", ["正向有功（峰）"]));
    let peakKwh = finiteNumber(segmentLastNumber(normalized, "正向有功（峰）", ["正向有功（平）"]));
    let flatKwh = finiteNumber(segmentLastNumber(normalized, "正向有功（平）", ["正向有功（谷）"]));
    let valleyKwh = finiteNumber(segmentLastNumber(normalized, "正向有功（谷）", ["正向无功（总）", "最大需量", "正向有功（总）"]));
    const ratios = extractRatioValues(normalized);
    const bandSum = sharpKwh + peakKwh + flatKwh + valleyKwh;
    if (!totalKwh && bandSum) totalKwh = bandSum;
    if (!bandSum && totalKwh && ratios.length >= 4) {
      [sharpKwh, peakKwh, flatKwh, valleyKwh] = ratios.map((ratio) => totalKwh * ratio / 100);
    }
    const warnings = [];
    if (!dates.length) warnings.push("未识别账单月份");
    if (!company) warnings.push("未识别企业名称");
    if (!totalKwh) warnings.push("未识别总电量");
    if (!(sharpKwh + peakKwh + flatKwh + valleyKwh)) warnings.push("未识别尖峰、峰、平、谷电量");
    const detectedBandSum = sharpKwh + peakKwh + flatKwh + valleyKwh;
    if (totalKwh && detectedBandSum && Math.abs(totalKwh - detectedBandSum) > Math.max(1, totalKwh * 0.001)) {
      warnings.push("分时电量合计与总电量存在差异，生成时将按比例校准");
    }
    return {
      fileName,
      company,
      month: dates[0]?.slice(0, 7) || "",
      periodStart: dates[0] || "",
      periodEnd: dates[1] || dates[0] || "",
      totalKwh,
      sharpKwh,
      peakKwh,
      flatKwh,
      valleyKwh,
      ratios,
      category,
      loadType: inferLoadType(company, category, {
        month: dates[0]?.slice(0, 7) || "",
        bandTotals: { S: sharpKwh, H: peakKwh, P: flatKwh, V: valleyKwh },
      }),
      warnings,
    };
  }

  async function extractText(file) {
    if (!pdfjsLib?.getDocument) throw new Error("PDF读取组件未加载，请刷新页面后重试。");
    if (pdfjsLib.GlobalWorkerOptions) pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdf.worker.min.js";
    const data = new Uint8Array(await file.arrayBuffer());
    const documentTask = pdfjsLib.getDocument({ data, isEvalSupported: false, useWorkerFetch: false });
    const document = await documentTask.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str || "").join(" "));
    }
    await document.destroy();
    return pages.join("\n");
  }

  async function parse(file) {
    return parseBillText(await extractText(file), file.name);
  }

  function normalizeBandTotals(record) {
    const totalKwh = finiteNumber(record.totalKwh);
    if (totalKwh <= 0) throw new Error("总用电量必须大于0。");
    const values = {
      S: Math.max(0, finiteNumber(record.sharpKwh)),
      H: Math.max(0, finiteNumber(record.peakKwh)),
      P: Math.max(0, finiteNumber(record.flatKwh)),
      V: Math.max(0, finiteNumber(record.valleyKwh)),
    };
    const sum = Object.values(values).reduce((total, value) => total + value, 0);
    if (sum <= 0) throw new Error("尖峰、峰、平、谷电量合计必须大于0。");
    if (Math.abs(totalKwh - sum) > Math.max(1, totalKwh * MAX_BAND_TOTAL_MISMATCH_RATIO)) {
      throw new Error("尖峰、峰、平、谷电量合计与总用电量差异超过1%，请核对账单识别结果后再生成。");
    }
    const scale = totalKwh / sum;
    Object.keys(values).forEach((code) => { values[code] *= scale; });
    return { totalKwh, values, originalSum: sum, scale };
  }

  function buildBandAllocationFactors(profileWeights, hourIndexes) {
    if (!hourIndexes.length) return [];
    const smoothedWeights = profileWeights.map((value, hourIndex) => {
      const previous = Math.max(0, finiteNumber(profileWeights[(hourIndex + 23) % 24]));
      const current = Math.max(0, finiteNumber(value));
      const next = Math.max(0, finiteNumber(profileWeights[(hourIndex + 1) % 24]));
      return current * 0.7 + (previous + next) * 0.15;
    });
    const averageWeight = hourIndexes.reduce(
      (sum, hourIndex) => sum + smoothedWeights[hourIndex],
      0,
    ) / hourIndexes.length || 1;
    const limitedOffsets = hourIndexes.map((hourIndex) => {
      const relativeDifference = smoothedWeights[hourIndex] / averageWeight - 1;
      return Math.max(
        -MAX_BAND_DEVIATION,
        Math.min(MAX_BAND_DEVIATION, relativeDifference * PROFILE_INFLUENCE),
      );
    });
    const offsetAverage = limitedOffsets.reduce((sum, value) => sum + value, 0) / limitedOffsets.length;
    let centeredOffsets = limitedOffsets.map((value) => value - offsetAverage);
    const largestOffset = Math.max(...centeredOffsets.map((value) => Math.abs(value)), 0);
    if (largestOffset > MAX_BAND_DEVIATION) {
      const scale = MAX_BAND_DEVIATION / largestOffset;
      centeredOffsets = centeredOffsets.map((value) => value * scale);
    }
    return centeredOffsets.map((value) => 1 + value);
  }

  function projectBandValues(values, total) {
    if (!values.length) return [];
    if (!(total > 0)) return values.map(() => 0);
    const average = total / values.length;
    const lower = average * (1 - MAX_BAND_DEVIATION);
    const upper = average * (1 + MAX_BAND_DEVIATION);
    const projected = values.map((value) => Math.max(lower, Math.min(upper, finiteNumber(value))));

    for (let iteration = 0; iteration < 12; iteration += 1) {
      const difference = total - projected.reduce((sum, value) => sum + value, 0);
      if (Math.abs(difference) < 1e-8) break;
      const adjustable = projected
        .map((value, index) => difference > 0 ? value < upper - 1e-10 ? index : -1 : value > lower + 1e-10 ? index : -1)
        .filter((index) => index >= 0);
      if (!adjustable.length) break;
      const adjustment = difference / adjustable.length;
      adjustable.forEach((index) => {
        projected[index] = Math.max(lower, Math.min(upper, projected[index] + adjustment));
      });
    }

    const finalDifference = total - projected.reduce((sum, value) => sum + value, 0);
    if (Math.abs(finalDifference) >= 1e-8) {
      const index = projected.findIndex((value) => {
        const next = value + finalDifference;
        return next >= lower - 1e-8 && next <= upper + 1e-8;
      });
      if (index >= 0) projected[index] += finalDifference;
    }
    return projected;
  }

  function refineHourlyAllocation(initialHours, bandCode, bandTotals) {
    let current = [...initialHours];
    for (let iteration = 0; iteration < SMOOTHING_ITERATIONS; iteration += 1) {
      const proposed = current.map((value, hourIndex) => {
        const previous = current[(hourIndex + 23) % 24];
        const next = current[(hourIndex + 1) % 24];
        const neighborAverage = (previous + next) / 2;
        return initialHours[hourIndex] * PROFILE_ANCHOR_WEIGHT
          + value * (1 - PROFILE_ANCHOR_WEIGHT - NEIGHBOR_SMOOTHING_WEIGHT)
          + neighborAverage * NEIGHBOR_SMOOTHING_WEIGHT;
      });
      const refined = Array(24).fill(0);
      Object.keys(BAND_FIELDS).forEach((code) => {
        const hourIndexes = [...bandCode]
          .map((value, hourIndex) => value === code ? hourIndex : -1)
          .filter((hourIndex) => hourIndex >= 0);
        const values = projectBandValues(hourIndexes.map((hourIndex) => proposed[hourIndex]), bandTotals[code]);
        hourIndexes.forEach((hourIndex, index) => { refined[hourIndex] = values[index]; });
      });
      current = refined;
    }
    return current;
  }

  function simulateHourlyKwh(record, touData = defaultTouData) {
    validateCompleteMonth(record);
    const { billYear, supportedYear } = validateSupportedYear(record, touData);
    const monthMatch = String(record.month || "").match(/-(\d{2})$/);
    const monthIndex = monthMatch ? Number(monthMatch[1]) - 1 : -1;
    if (monthIndex < 0 || monthIndex > 11) throw new Error("请选择正确的账单月份。");
    const bandCode = touData?.bandCodes?.[monthIndex];
    if (!bandCode || bandCode.length < 24) throw new Error(`${monthIndex + 1}月缺少国网24小时时段配置。`);
    const profile = LOAD_PROFILES[record.loadType] || LOAD_PROFILES.straight;
    const { totalKwh, values: bandTotals, scale } = normalizeBandTotals(record);
    let hours = Array(24).fill(0);

    Object.entries(BAND_FIELDS).forEach(([code]) => {
      const bandTotal = bandTotals[code];
      const hourIndexes = [...bandCode].map((value, index) => value === code ? index : -1).filter((index) => index >= 0);
      if (!hourIndexes.length) {
        if (bandTotal > 0.01) throw new Error(`${monthIndex + 1}月国网时段没有${BAND_LABELS[code]}，但账单${BAND_LABELS[code]}电量不为0。`);
        return;
      }
      const allocationFactors = buildBandAllocationFactors(profile.weights, hourIndexes);
      const factorTotal = allocationFactors.reduce((sum, value) => sum + value, 0);
      let assigned = 0;
      hourIndexes.forEach((hourIndex, index) => {
        const value = index === hourIndexes.length - 1
          ? bandTotal - assigned
          : bandTotal * allocationFactors[index] / factorTotal;
        hours[hourIndex] = value;
        assigned += value;
      });
    });
    hours = refineHourlyAllocation(hours, bandCode, bandTotals);
    return {
      hours,
      bandCode,
      monthIndex,
      totalKwh,
      scale,
      profile,
      profileInfluence: PROFILE_INFLUENCE,
      maximumBandDeviation: MAX_BAND_DEVIATION,
      billYear,
      supportedYear,
    };
  }

  function createWorkbook(record, touData = defaultTouData) {
    const company = String(record.company || "").trim();
    if (!company) throw new Error("企业名称不能为空。");
    const simulation = simulateHourlyKwh(record, touData);
    const normalizedBands = normalizeBandTotals(record).values;
    const month = String(record.month);
    const date = `${month}-01`;
    const valuesMwh = simulation.hours.map((value) => Number((value / 1000).toFixed(6)));
    const targetMwh = Number((simulation.totalKwh / 1000).toFixed(6));
    const difference = Number((targetMwh - valuesMwh.reduce((sum, value) => sum + value, 0)).toFixed(6));
    if (difference) {
      const lastIndex = [...valuesMwh].map((value, index) => value > 0 ? index : -1).filter((index) => index >= 0).at(-1) ?? 23;
      valuesMwh[lastIndex] = Number((valuesMwh[lastIndex] + difference).toFixed(6));
    }
    const rows = [["企业名称", "日期", "时点", "电量(MWh)", "国网时段", "数据来源", "负荷类型"]];
    valuesMwh.forEach((value, hourIndex) => {
      rows.push([
        company,
        date,
        `${String(hourIndex).padStart(2, "0")}:00`,
        value,
        BAND_LABELS[simulation.bandCode[hourIndex]] || simulation.bandCode[hourIndex],
        "国网PDF账单模拟",
        simulation.profile.label,
      ]);
    });
    return {
      sheets: [{ name: "PDF账单模拟", rows }],
      billMeta: {
        ...record,
        normalizedBandKwh: Object.fromEntries(Object.entries(BAND_FIELDS).map(([code, field]) => [field, normalizedBands[code]])),
        timeBandYear: touData?.analysisYear || null,
        timeBandMonth: month,
        timeBandCode: simulation.bandCode,
        monthIndex: simulation.monthIndex,
      },
    };
  }

  function formatHourRange(hourIndex) {
    const start = String(hourIndex).padStart(2, "0");
    const end = hourIndex === 23 ? "00" : String(hourIndex + 1).padStart(2, "0");
    return `${start}:00-${end}:00`;
  }

  function compactRangesForCode(bandCode, targetCode) {
    const runs = [];
    let start = null;
    for (let index = 0; index <= 24; index += 1) {
      const matches = index < 24 && bandCode[index] === targetCode;
      if (matches && start == null) start = index;
      if (!matches && start != null) {
        runs.push({ start, end: index });
        start = null;
      }
    }
    if (runs.length > 1 && runs[0].start === 0 && runs.at(-1).end === 24) {
      const first = runs.shift();
      const last = runs.pop();
      runs.unshift({ start: last.start, end: first.end, overnight: true });
    }
    return runs.map((run) => {
      const startText = `${String(run.start).padStart(2, "0")}:00`;
      if (run.overnight) return `${startText}-次日${String(run.end).padStart(2, "0")}:00`;
      const endText = run.end === 24 ? "24:00" : `${String(run.end).padStart(2, "0")}:00`;
      return `${startText}-${endText}`;
    });
  }

  function describeTimeBands(record, touData = defaultTouData) {
    const simulation = simulateHourlyKwh(record, touData);
    const ranges = Object.fromEntries(
      Object.keys(BAND_FIELDS).map((code) => [code, compactRangesForCode(simulation.bandCode, code)]),
    );
    return {
      year: simulation.supportedYear,
      month: simulation.monthIndex + 1,
      sourceName: touData?.officialSources?.grid?.name || "电网企业代理购电工商业用户电价价格表",
      sourceUrl: touData?.officialSources?.grid?.url || "",
      bandCode: simulation.bandCode,
      ranges,
      profileInfluence: simulation.profileInfluence,
      maximumBandDeviation: simulation.maximumBandDeviation,
    };
  }

  return {
    LOAD_PROFILES,
    BAND_LABELS,
    MIN_SUPPORTED_BILL_YEAR,
    PROFILE_INFLUENCE,
    MAX_BAND_DEVIATION,
    NEIGHBOR_SMOOTHING_WEIGHT,
    PROFILE_ANCHOR_WEIGHT,
    SMOOTHING_ITERATIONS,
    MAX_BAND_TOTAL_MISMATCH_RATIO,
    normalizedBandShares,
    profileBandShares,
    inferLoadType,
    parseBillText,
    parse,
    normalizeBandTotals,
    buildBandAllocationFactors,
    refineHourlyAllocation,
    validateCompleteMonth,
    validateSupportedYear,
    describeTimeBands,
    simulateHourlyKwh,
    createWorkbook,
  };
});
