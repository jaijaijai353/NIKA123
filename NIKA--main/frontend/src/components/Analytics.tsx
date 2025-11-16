import React, { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ActivitySquare,
  BarChart3,
  Binary,
  Brain,
  CheckCircle2,
  ChevronDown,
  Database,
  FileSearch,
  Layers,
  ListChecks,
  ListOrdered,
  ListTree,
  PieChart as PieChartIcon,
  ScanSearch,
  Sigma,
  SigmaSquare,
  Table as TableIcon,
  TrendingUp,
  AlertTriangle,
} from "lucide-react";
import { useDataContext } from "../context/DataContext";

/**
 * ======================================================================================
 * AnalyticsTextReport.tsx
 * --------------------------------------------------------------------------------------
 * Purely text/table analytics report (NO visual charts) with an animated, modern UI.
 *
 * What you get:
 *  - Data Health: missingness, duplicates, low variance, high cardinality, mixed types, possible primary key
 *  - Descriptive Stats:
 *      • Numeric: count, mean, median, mode, std, variance, min, max, range, skewness, kurtosis
 *      • Categorical: unique count, most/least frequent categories, entropy
 *      • Datetime: min/max, span, most common month/weekday
 *  - Relationships:
 *      • Numeric-numeric Pearson correlations (top | bottom)
 *      • Categorical-categorical chi-square (stat, df) summary (optional light)
 *  - Outliers/Anomalies:
 *      • Z-score and IQR outlier counts per numeric column
 *  - Plain-language Insights synthesized from the above
 *
 * Defensive coding across undefined contexts and mixed input shapes.
 *
 * Styling: Tailwind CSS. Animations: framer-motion. Icons: lucide-react.
 * ======================================================================================
 */

/** ---------------------------------- Types ---------------------------------------- */
type DataRow = Record<string, any>;

type DatasetShape = {
  columns?: Array<{
    name: string;
    type?: string;
  }>;
  data?: DataRow[];
};

type ContextShape =
  | {
      dataset?: DatasetShape | null;
      data?: DataRow[] | null;
      updateCounter?: number;
    }
  | any;

/** ------------------------------ Small Utilities --------------------------------- */
const isFiniteNumber = (v: any) => typeof v === "number" && Number.isFinite(v);
const isMissing = (v: any) => v === null || v === undefined || (typeof v === "number" && Number.isNaN(v)) || v === "";
const clamp = (x: number, a: number, b: number) => Math.min(Math.max(x, a), b);
const fmt = (x: any, digits = 3) => (typeof x === "number" && Number.isFinite(x) ? x.toFixed(digits) : "—");
const tryDate = (v: any) => {
  // Accept JS Date, ISO strings, or parseable strings/numbers
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/** --------------------------- Basic Stats (Robust) -------------------------------- */
const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0);
const variance = (a: number[]) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return sum(a.map((x) => (x - m) ** 2)) / (a.length - 1);
};
const stdDev = (a: number[]) => Math.sqrt(variance(a));
const median = (a: number[]) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mode = (a: (string | number)[]) => {
  if (!a.length) return null;
  const map = new Map<any, number>();
  for (const v of a) map.set(v, (map.get(v) || 0) + 1);
  let best: any = null,
    bestC = -1;
  for (const [k, c] of map) if (c > bestC) (best = k), (bestC = c);
  return best;
};
const minMax = (a: number[]) => {
  if (!a.length) return { min: 0, max: 0 };
  let mn = a[0],
    mx = a[0];
  for (let i = 1; i < a.length; i++) {
    if (a[i] < mn) mn = a[i];
    if (a[i] > mx) mx = a[i];
  }
  return { min: mn, max: mx };
};
// Unbiased (Fisher) sample skewness and excess kurtosis approximations
const skewness = (a: number[]) => {
  const n = a.length;
  if (n < 3) return 0;
  const m = mean(a);
  const s = stdDev(a);
  if (!s) return 0;
  const m3 = sum(a.map((x) => (x - m) ** 3)) / n;
  return (Math.sqrt(n * (n - 1)) / (n - 2)) * (m3 / s ** 3);
};
const kurtosisExcess = (a: number[]) => {
  const n = a.length;
  if (n < 4) return 0;
  const m = mean(a);
  const s2 = variance(a);
  if (!s2) return 0;
  const s = Math.sqrt(s2);
  const m4 = sum(a.map((x) => (x - m) ** 4)) / n;
  // excess kurtosis (kurtosis - 3)
  const g2 = m4 / s ** 4 - 3;
  // Small sample correction (Fisher)
  const term1 = ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * g2 + 6);
  return term1;
};

/** --------------------------- Relationships & Tests ------------------------------- */
const pearson = (x: number[], y: number[]) => {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  let sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = y[i];
    if (!isFiniteNumber(xi) || !isFiniteNumber(yi)) continue;
    sx += xi;
    sy += yi;
    sxx += xi * xi;
    syy += yi * yi;
    sxy += xi * yi;
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return den ? num / den : 0;
};

// Simple chi-square statistic for cat-cat association (no exact p-value here)
const chiSquareStat = (table: number[][]) => {
  const r = table.length;
  const c = table[0]?.length || 0;
  if (!r || !c) return { chi2: 0, df: 0 };
  const rowSums = table.map((row) => row.reduce((a, b) => a + b, 0));
  const colSums: number[] = Array(c).fill(0);
  for (let j = 0; j < c; j++) for (let i = 0; i < r; i++) colSums[j] += table[i][j];
  const total = rowSums.reduce((a, b) => a + b, 0) || 1;
  let chi2 = 0;
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) {
      const expected = (rowSums[i] * colSums[j]) / total;
      if (expected > 0) chi2 += ((table[i][j] - expected) ** 2) / expected;
    }
  }
  const df = (r - 1) * (c - 1);
  return { chi2, df };
};

/** ------------------------------- Outlier Logic ----------------------------------- */
const zScoreOutliers = (a: number[], threshold = 3) => {
  const m = mean(a);
  const s = stdDev(a);
  if (!s) return { count: 0, idx: [] as number[] };
  const idx: number[] = [];
  for (let i = 0; i < a.length; i++) {
    const z = (a[i] - m) / s;
    if (Math.abs(z) > threshold) idx.push(i);
  }
  return { count: idx.length, idx };
};
const iqrOutliers = (a: number[]) => {
  if (!a.length) return { count: 0, idx: [] as number[], fences: [0, 0] as [number, number] };
  const s = [...a].sort((x, y) => x - y);
  const q1 = s[Math.floor((s.length * 1) / 4)];
  const q3 = s[Math.floor((s.length * 3) / 4)];
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  const idx: number[] = [];
  s.forEach((v, i) => {
    if (v < lo || v > hi) idx.push(i);
  });
  return { count: idx.length, idx, fences: [lo, hi] as [number, number] };
};

/** ---------------------------- Entropy (Categorical) ------------------------------ */
const entropy = (values: any[]) => {
  const counts = new Map<any, number>();
  let n = 0;
  for (const v of values) {
    if (isMissing(v)) continue;
    n += 1;
    const key = String(v);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (n === 0) return 0;
  let H = 0;
  for (const [, c] of counts) {
    const p = c / n;
    H += -p * Math.log2(p);
  }
  return H; // bits
};

/** ----------------------------- Inference & Shaping ------------------------------- */
const useRowsAndColumns = (ctx: ContextShape) => {
  const dataset: DatasetShape | null | undefined = ctx?.dataset ?? null;
  const plain: DataRow[] | null | undefined = ctx?.data ?? null;

  const rows: DataRow[] = useMemo(() => {
    if (dataset?.data && Array.isArray(dataset.data)) return dataset.data as DataRow[];
    if (Array.isArray(plain)) return plain as DataRow[];
    return [];
  }, [dataset?.data, plain]);

  const columns = useMemo(() => {
    if (dataset?.columns?.length) return dataset.columns.map((c) => c.name);
    if (rows.length) return Object.keys(rows[0]);
    return [];
  }, [dataset?.columns, rows]);

  // infer types: numeric, categorical, datetime
  const { numericCols, categoricalCols, datetimeCols } = useMemo(() => {
    const num: string[] = [];
    const cat: string[] = [];
    const dt: string[] = [];
    for (const col of columns) {
      // scan first 50 non-missing values to infer
      let sawNum = false,
        sawStr = false,
        sawDate = false;
      let checked = 0;
      for (let i = 0; i < rows.length && checked < 50; i++) {
        const v = rows[i]?.[col];
        if (isMissing(v)) continue;
        checked++;
        const n = Number(v);
        if (Number.isFinite(n) && typeof v !== "boolean") sawNum = true;
        if (typeof v === "string") {
          sawStr = true;
          if (tryDate(v)) sawDate = true;
        }
        if (v instanceof Date) sawDate = true;
      }
      if (sawDate) dt.push(col);
      else if (sawNum) num.push(col);
      else cat.push(col);
    }
    return { numericCols: num, categoricalCols: cat, datetimeCols: dt };
  }, [columns, rows]);

  return { rows, columns, numericCols, categoricalCols, datetimeCols };
};

/** --------------------------- Duplicate & Mixed Type Checks ----------------------- */
const countDuplicates = (rows: DataRow[]) => {
  const seen = new Set<string>();
  let dups = 0;
  for (const r of rows) {
    const key = JSON.stringify(r, Object.keys(r).sort());
    if (seen.has(key)) dups++;
    else seen.add(key);
  }
  return dups;
};
const mixedTypesByColumn = (rows: DataRow[], columns: string[]) => {
  return columns.map((col) => {
    const types = new Set<string>();
    for (let i = 0; i < rows.length && types.size <= 3; i++) {
      const v = rows[i]?.[col];
      if (isMissing(v)) continue;
      types.add(Array.isArray(v) ? "array" : typeof v);
    }
    return { column: col, types: Array.from(types).sort() };
  });
};

/** --------------------------- Section UI Helpers ---------------------------------- */
const Section: React.FC<{
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ icon, title, subtitle, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-[#0c0f14] border border-gray-800 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 p-4 hover:bg-gray-900/50 transition"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gray-900 border border-gray-800">{icon}</div>
          <div className="text-left">
            <div className="text-base md:text-lg font-semibold text-gray-100">{title}</div>
            {subtitle ? <div className="text-xs md:text-sm text-gray-400">{subtitle}</div> : null}
          </div>
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }}>
          <ChevronDown className="w-5 h-5 text-gray-400" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="px-4 pb-4"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const StatCard: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({ label, value, hint }) => (
  <motion.div
    initial={{ opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.3 }}
    className="bg-[#0a0d12] border border-gray-800 rounded-xl p-4"
  >
    <div className="text-xs text-gray-400">{label}</div>
    <div className="text-xl font-semibold text-gray-100 mt-1">{value}</div>
    {hint ? <div className="text-[11px] text-gray-500 mt-1">{hint}</div> : null}
  </motion.div>
);

/** ------------------------------ Main Component ----------------------------------- */
const AnalyticsTextReport: React.FC = () => {
  const ctx = useDataContext() as ContextShape;

  // Normalize
  const { rows, columns, numericCols, categoricalCols, datetimeCols } = useRowsAndColumns(ctx);

  // Derived counts
  const totalRows = rows.length;
  const totalCols = columns.length;
  const duplicateCount = useMemo(() => countDuplicates(rows), [rows]);

  // Missing per column
  const missingByCol = useMemo(() => {
    return columns.map((c) => {
      const miss = rows.reduce((acc, r) => (isMissing(r?.[c]) ? acc + 1 : acc), 0);
      return { column: c, missing: miss, percent: totalRows ? (miss / totalRows) * 100 : 0 };
    });
  }, [rows, columns, totalRows]);

  // Low variance & high cardinality
  const lowVarianceCols = useMemo(() => {
    const out: string[] = [];
    for (const c of numericCols) {
      const vals = rows.map((r) => Number(r?.[c])).filter(isFiniteNumber);
      const v = variance(vals);
      if (v === 0) out.push(c);
    }
    return out;
  }, [rows, numericCols]);

  const cardinalityByCol = useMemo(() => {
    return columns.map((c) => {
      const vals = rows.map((r) => r?.[c]).filter((v) => !isMissing(v));
      const u = new Set(vals.map((v) => (typeof v === "number" && Number.isNaN(v) ? "__NaN__" : v))).size;
      return { column: c, unique: u };
    });
  }, [rows, columns]);

  const highCardinalityCols = useMemo(() => {
    return cardinalityByCol.filter((x) => x.unique > Math.max(50, totalRows * 0.5)).map((x) => x.column);
  }, [cardinalityByCol, totalRows]);

  // Mixed types & primary key candidates
  const mixedTypes = useMemo(() => mixedTypesByColumn(rows, columns), [rows, columns]);
  const primaryKeyCandidates = useMemo(() => {
    return cardinalityByCol
      .filter((x) => x.unique === totalRows && totalRows > 0)
      .map((x) => x.column);
  }, [cardinalityByCol, totalRows]);

  // Numeric descriptive stats
  const numericStats = useMemo(() => {
    return numericCols.map((c) => {
      const vals = rows.map((r) => Number(r?.[c])).filter(isFiniteNumber);
      const cnt = vals.length;
      const m = mean(vals);
      const med = median(vals);
      const mo = mode(vals) as number | null;
      const sd = stdDev(vals);
      const v = variance(vals);
      const { min, max } = minMax(vals);
      const range = max - min;
      const sk = skewness(vals);
      const ku = kurtosisExcess(vals);
      return { column: c, count: cnt, mean: m, median: med, mode: mo, std: sd, variance: v, min, max, range, skewness: sk, kurtosis: ku };
    });
  }, [rows, numericCols]);

  // Outliers per numeric: z-score & IQR
  const outliersByNumeric = useMemo(() => {
    return numericCols.map((c) => {
      const vals = rows.map((r) => Number(r?.[c])).filter(isFiniteNumber);
      const z = zScoreOutliers(vals, 3);
      const iqr = iqrOutliers(vals);
      return { column: c, zCount: z.count, iqrCount: iqr.count, iqrFences: iqr.fences };
    });
  }, [rows, numericCols]);

  // Categorical descriptive stats
  const categoricalStats = useMemo(() => {
    return categoricalCols.map((c) => {
      const vals = rows.map((r) => r?.[c]).filter((v) => !isMissing(v));
      const freq = new Map<string, number>();
      for (const v of vals) {
        const k = String(v);
        freq.set(k, (freq.get(k) || 0) + 1);
      }
      const pairs = Array.from(freq, ([k, v]) => ({ value: k, count: v }))
        .sort((a, b) => b.count - a.count);
      const most = pairs[0]?.value ?? null;
      const least = pairs.length ? pairs[pairs.length - 1].value : null;
      const ent = entropy(vals);
      return { column: c, unique: freq.size, most, least, top: pairs.slice(0, 5), entropy: ent };
    });
  }, [rows, categoricalCols]);

  // Datetime stats
  const datetimeStats = useMemo(() => {
    return datetimeCols.map((c) => {
      const dates: Date[] = [];
      for (const r of rows) {
        const d = tryDate(r?.[c]);
        if (d) dates.push(d);
      }
      if (!dates.length) return { column: c, count: 0, min: null as Date | null, max: null as Date | null, spanDays: 0, commonMonth: "—", commonWeekday: "—" };
      dates.sort((a, b) => +a - +b);
      const min = dates[0];
      const max = dates[dates.length - 1];
      const spanDays = Math.max(0, Math.round((+max - +min) / (1000 * 60 * 60 * 24)));
      const monthFreq = new Map<number, number>();
      const weekdayFreq = new Map<number, number>();
      for (const d of dates) {
        monthFreq.set(d.getMonth(), (monthFreq.get(d.getMonth()) || 0) + 1);
        weekdayFreq.set(d.getDay(), (weekdayFreq.get(d.getDay()) || 0) + 1);
      }
      const best = (m: Map<number, number>) => {
        let k = -1,
          c = -1;
        for (const [kk, vv] of m) if (vv > c) (k = kk), (c = vv);
        return k;
      };
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return {
        column: c,
        count: dates.length,
        min,
        max,
        spanDays,
        commonMonth: monthNames[clamp(best(monthFreq), 0, 11)] ?? "—",
        commonWeekday: weekdayNames[clamp(best(weekdayFreq), 0, 6)] ?? "—",
      };
    });
  }, [rows, datetimeCols]);

  // Correlations (numeric only)
  const correlations = useMemo(() => {
    const out: { pair: string; x: string; y: string; corr: number }[] = [];
    for (let i = 0; i < numericCols.length; i++) {
      for (let j = i + 1; j < numericCols.length; j++) {
        const x = numericCols[i];
        const y = numericCols[j];
        const xs = rows.map((r) => Number(r?.[x])).filter(isFiniteNumber);
        const ys = rows.map((r) => Number(r?.[y])).filter(isFiniteNumber);
        const n = Math.min(xs.length, ys.length);
        if (n < 2) continue;
        const corr = pearson(xs.slice(0, n), ys.slice(0, n));
        out.push({ pair: `${x} ↔ ${y}`, x, y, corr });
      }
    }
    out.sort((a, b) => Math.abs(b.corr) - Math.abs(a.corr));
    return out;
  }, [rows, numericCols]);

  // Categorical vs categorical chi-square (lightweight)
  const chiSquarePairs = useMemo(() => {
    const out: { pair: string; x: string; y: string; chi2: number; df: number }[] = [];
    if (categoricalCols.length < 2) return out;
    const maxCats = 12; // cap to avoid explosion
    for (let i = 0; i < categoricalCols.length; i++) {
      for (let j = i + 1; j < categoricalCols.length; j++) {
        const x = categoricalCols[i];
        const y = categoricalCols[j];
        // build levels
        const xVals = Array.from(new Set(rows.map((r) => String(r?.[x])))).slice(0, maxCats);
        const yVals = Array.from(new Set(rows.map((r) => String(r?.[y])))).slice(0, maxCats);
        if (!xVals.length || !yVals.length) continue;
        const table: number[][] = Array.from({ length: xVals.length }, () => Array(yVals.length).fill(0));
        for (const r of rows) {
          const xi = xVals.indexOf(String(r?.[x]));
          const yi = yVals.indexOf(String(r?.[y]));
          if (xi >= 0 && yi >= 0) table[xi][yi] += 1;
        }
        const { chi2, df } = chiSquareStat(table);
        out.push({ pair: `${x} ~ ${y}`, x, y, chi2, df });
      }
    }
    out.sort((a, b) => b.chi2 - a.chi2);
    return out.slice(0, 10);
  }, [rows, categoricalCols]);

  // Text columns: simple word stats (optional)
  const textCols = useMemo(() => {
    return columns.filter((c) => !numericCols.includes(c) && !datetimeCols.includes(c));
  }, [columns, numericCols, datetimeCols]);

  const textStats = useMemo(() => {
    const out: { column: string; avgWords: number; topWords: { token: string; count: number }[] }[] = [];
    const stop = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "is", "are", "on", "for", "with", "as", "at", "by"]);
    for (const c of textCols) {
      let totalWords = 0,
        docs = 0;
      const freq = new Map<string, number>();
      for (const r of rows) {
        const v = r?.[c];
        if (typeof v !== "string" || !v.trim()) continue;
        docs++;
        const tokens = v
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((t) => t && !stop.has(t));
        totalWords += tokens.length;
        for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);
      }
      if (!docs) continue;
      const avgWords = totalWords / docs;
      const topWords = Array.from(freq, ([token, count]) => ({ token, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      out.push({ column: c, avgWords, topWords });
    }
    return out;
  }, [rows, textCols]);

  // Synthesized Insights (plain language)
  const insights = useMemo(() => {
    const lines: string[] = [];
    if (!totalRows || !totalCols) {
      lines.push("No data available. Upload a dataset to generate insights.");
      return lines;
    }
    // Missingness
    const badMiss = missingByCol.filter((x) => x.percent > 20).sort((a, b) => b.percent - a.percent);
    if (badMiss.length) lines.push(`High missingness in: ${badMiss.slice(0, 5).map((x) => `${x.column} (${x.percent.toFixed(1)}%)`).join(", ")}. Consider imputing or dropping.`);

    // Duplicates
    if (duplicateCount > 0) lines.push(`${duplicateCount} duplicate row(s) detected. Consider deduplication.`);

    // Primary key
    if (primaryKeyCandidates.length) lines.push(`Possible primary key(s): ${primaryKeyCandidates.join(", ")}.`);

    // Numeric skew/outliers
    for (const s of numericStats) {
      if (Math.abs(s.skewness) > 1) lines.push(`Column "${s.column}" is highly skewed (${s.skewness.toFixed(2)}). Consider transformation.`);
    }
    for (const o of outliersByNumeric) {
      if (o.zCount > 0 || o.iqrCount > 0) lines.push(`Outliers in "${o.column}": z-score=${o.zCount}, IQR=${o.iqrCount}.`);
    }

    // Correlations
    if (correlations.length) {
      const top = correlations.slice(0, 3).map((c) => `${c.pair} (${c.corr >= 0 ? "+" : ""}${c.corr.toFixed(2)})`).join(", ");
      lines.push(`Top correlations: ${top}.`);
    }

    // Categorical dominance
    for (const c of categoricalStats) {
      const top = c.top?.[0];
      if (top && totalRows > 0) {
        const pct = (top.count / totalRows) * 100;
        if (pct > 70) lines.push(`Column "${c.column}" is heavily dominated by "${top.value}" (${pct.toFixed(1)}%).`);
      }
    }

    // Datetime coverage
    for (const d of datetimeStats) {
      if (d.min && d.max) lines.push(`Column "${d.column}" covers ${d.spanDays} day(s) from ${d.min.toISOString().slice(0, 10)} to ${d.max.toISOString().slice(0, 10)}.`);
    }

    return lines;
  }, [totalRows, totalCols, missingByCol, duplicateCount, primaryKeyCandidates, numericStats, outliersByNumeric, correlations, categoricalStats, datetimeStats]);

  // ---------- UI: Empty State ----------
  if (!totalRows || !totalCols) {
    return (
      <div className="h-64 grid place-items-center">
        <div className="text-gray-400">No data available. Please upload a dataset to see analytics.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="bg-[#111318] border border-gray-800 rounded-2xl p-5"
      >
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
              <Brain className="w-6 h-6 text-teal-400" /> Analytics Report (Text-Only)
            </h2>
            <p className="text-sm text-gray-400">Data-driven insights without charts — perfect for quick diagnostics and exports.</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Rows" value={totalRows} />
            <StatCard label="Columns" value={totalCols} />
            <StatCard label="Numeric" value={numericCols.length} />
            <StatCard label="Categorical" value={categoricalCols.length} />
          </div>
        </div>
      </motion.div>

      {/* Data Health */}
      <Section
        icon={<ActivitySquare className="w-5 h-5 text-blue-300" />}
        title="Data Health Overview"
        subtitle="Missingness, duplicates, cardinality, and type sanity checks"
        defaultOpen
      >
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-[#0a0d12] border border-gray-800 rounded-xl p-4">
            <div className="text-sm font-semibold text-gray-200 mb-2 flex items-center gap-2"><AlertTriangle className="w-4 h-4"/> Missingness (Top 10)</div>
            <div className="max-h-56 overflow-auto text-sm">
              <table className="w-full">
                <thead>
                  <tr className="text-gray-400 text-xs border-b border-gray-800">
                    <th className="text-left py-2 pr-2">Column</th>
                    <th className="text-right py-2">Missing</th>
                    <th className="text-right py-2">%</th>
                  </tr>
                </thead>
                <tbody>
                  {missingByCol
                    .slice()
                    .sort((a, b) => b.percent - a.percent)
                    .slice(0, 10)
                    .map((m) => (
                      <tr key={m.column} className="border-b border-gray-900/60">
                        <td className="py-2 pr-2 text-gray-100">{m.column}</td>
                        <td className="py-2 text-right text-gray-300">{m.missing}</td>
                        <td className="py-2 text-right text-gray-300">{m.percent.toFixed(2)}%</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <StatCard label="Duplicates" value={duplicateCount} />
            <StatCard label="Low-Variance (0)" value={lowVarianceCols.length} hint={lowVarianceCols.join(", ") || undefined} />
            <StatCard label="High Cardinality" value={highCardinalityCols.length} hint={highCardinalityCols.join(", ") || undefined} />
            <StatCard label="Primary Key?" value={primaryKeyCandidates.length ? "Yes" : "No"} hint={primaryKeyCandidates.join(", ") || undefined} />
          </div>
        </div>
        <div className="mt-4">
          <div className="text-sm font-semibold text-gray-200 mb-2 flex items-center gap-2"><ListChecks className="w-4 h-4"/> Mixed Type Columns</div>
          <div className="overflow-auto max-h-40 text-sm">
            <table className="w-full">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-gray-800">
                  <th className="text-left py-2 pr-2">Column</th>
                  <th className="text-left py-2">Types seen</th>
                </tr>
              </thead>
              <tbody>
                {mixedTypes.map((t) => (
                  <tr key={t.column} className="border-b border-gray-900/60">
                    <td className="py-2 pr-2 text-gray-100">{t.column}</td>
                    <td className="py-2 text-gray-300">{t.types.join(", ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* Descriptive Stats */}
      <Section icon={<Sigma className="w-5 h-5 text-violet-300" />} title="Descriptive Statistics" subtitle="Numeric, categorical, and datetime summaries">
        <div className="grid gap-4">
          {/* Numeric */}
          <div className="bg-[#0a0d12] border border-gray-800 rounded-xl p-4">
            <div className="text-sm font-semibold text-gray-200 mb-2 flex items-center gap-2"><BarChart3 className="w-4 h-4"/> Numeric Columns</div>
            <div className="overflow-auto max-h-80 text-xs md:text-sm">
              <table className="w-full">
                <thead>
                  <tr className="text-gray-400 text-xs border-b border-gray-800">
                    {[
                      "Column",
                      "Count",
                      "Mean",
                      "Median",
                      "Mode",
                      "Std",
                      "Var",
                      "Min",
                      "Max",
                      "Range",
                      "Skew",
                      "Kurtosis",
                    ].map((h) => (
                      <th key={h} className={`text-left py-2 ${h === "Column" ? "pr-2" : "text-right"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {numericStats.map((s) => (
                    <tr key={s.column} className="border-b border-gray-900/60">
                      <td className="py-2 pr-2 text-gray-100">{s.column}</td>
                      <td className="py-2 text-right text-gray-300">{s.count}</td>
                      <td className="py-2 text-right text-gray-300">{fmt(s.mean)}</td>
                      <td className="py-2 text-right text-gray-300">{fmt(s.median)}</td>
                      <td className="py-2 text-right text-gray-300">{s.mode ?? "—"}</td>
                      <td className="py-2 text-right text-gray-300">{fmt(s.std)}</td>
                      <td className="py-2 text-right text-gray-300">{fmt(s.variance)}</td>
                      <td className="py-2 text-right text-gray-300">{fmt(s.min)}</td>
                      <td className="py-2 text-right text-gray-300">{fmt(s.max)}</td>
                      <td className="py-2 text-right text-gray-300">{fmt(s.range)}</td>
                      <td className="py-2 text-right text-gray-300">{fmt(s.skewness)}</td>
                      <td className="py-2 text-right text-gray-300">{fmt(s.kurtosis)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Categorical */}
          <div className="bg-[#0a0d12] border border-gray-800 rounded-xl p-4">
            <div className="text-sm font-semibold text-gray-200 mb-2 flex items-center gap-2"><PieChartIcon className="w-4 h-4"/> Categorical Columns</div>
            <div className="overflow-auto max-h-80 text-xs md:text-sm">
              <table className="w-full">
                <thead>
                  <tr className="text-gray-400 text-xs border-b border-gray-800">
                    <th className="text-left py-2 pr-2">Column</th>
                    <th className="text-right py-2">Unique</th>
                    <th className="text-left py-2">Top Values (count)</th>
                    <th className="text-left py-2">Most</th>
                    <th className="text-left py-2">Least</th>
                    <th className="text-right py-2">Entropy</th>
                  </tr>
                </thead>
                <tbody>
                  {categoricalStats.map((c) => (
                    <tr key={c.column} className="border-b border-gray-900/60">
                      <td className="py-2 pr-2 text-gray-100">{c.column}</td>
                      <td className="py-2 text-right text-gray-300">{c.unique}</td>
                      <td className="py-2 text-gray-300">
                        {c.top?.map((t) => (
                          <span key={t.value} className="inline-block mr-2 mb-1 px-2 py-0.5 rounded bg-gray-900/80 border border-gray-800 text-xs">
                            {t.value} <span className="text-gray-400">({t.count})</span>
                          </span>
                        ))}
                      </td>
                      <td className="py-2 text-gray-300">{c.most ?? "—"}</td>
                      <td className="py-2 text-gray-300">{c.least ?? "—"}</td>
                      <td className="py-2 text-right text-gray-300">{fmt(c.entropy, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Datetime */}
          <div className="bg-[#0a0d12] border border-gray-800 rounded-xl p-4">
            <div className="text-sm font-semibold text-gray-200 mb-2 flex items-center gap-2"><CalendarIcon/> Datetime Columns</div>
            <div className="overflow-auto max-h-80 text-xs md:text-sm">
              <table className="w-full">
                <thead>
                  <tr className="text-gray-400 text-xs border-b border-gray-800">
                    <th className="text-left py-2 pr-2">Column</th>
                    <th className="text-right py-2">Count</th>
                    <th className="text-left py-2">Min</th>
      _BOS_             <th className="text-left py-2">Max</th>
                    <th className="text-right py-2">Span (days)</th>
                    <th className="text-left py-2">Common Month</th>
                    <th className="text-left py-2">Common Weekday</th>
                  </tr>
                </thead>
                <tbody>
                  {datetimeStats.map((d) => (
                    <tr key={d.column} className="border-b border-gray-900/60">
                      <td className="py-2 pr-2 text-gray-100">{d.column}</td>
                      <td className="py-2 text-right text-gray-300">{d.count}</td>
                      <td className="py-2 text-gray-300">{d.min ? d.min.toISOString().slice(0, 10) : "—"}</td>
                      <td className="py-2 text-gray-300">{d.max ? d.max.toISOString().slice(0, 10) : "—"}</td>
                      <td className="py-2 text-right text-gray-300">{d.spanDays}</td>
                      <td className="py-2 text-gray-300">{d.commonMonth}</td>
                      <td className="py-2 text-gray-300">{d.commonWeekday}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Section>

      {/* Relationships */}
      <Section icon={<ListTree className="w-5 h-5 text-emerald-300" />} title="Relationships" subtitle="Numeric correlations and categorical associations">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-[#0a0d12] border border-gray-800 rounded-xl p-4">
            <div className="text-sm font-semibold text-gray-200 mb-2 flex items-center gap-2"><TrendingUp className="w-4 h-4"/> Top | Bottom Correlations</div>
            <div className="text-xs text-gray-400 mb-2">Absolute strongest and weakest relationships between numeric pairs.</div>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-xs font-semibold text-gray-300 mb-1">Strongest (Top 5)</div>
                <ul className="text-sm text-gray-200 space-y-1 max-h-56 overflow-auto">
                  {correlations.slice(0, 5).map((c) => (
                    <li key={c.pair} className="flex items-center justify-between gap-3">
                      <span className="truncate">{c.pair}</span>
                      <span className="text-gray-400">{c.corr >= 0 ? "+" : ""}{c.corr.toFixed(3)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-300 mb-1">Weakest (Bottom 5)</div>
                <ul className="text-sm text-gray-200 space-y-1 max-h-56 overflow-auto">
                  {correlations
                    .slice()
                    .sort((a, b) => Math.abs(a.corr) - Math.abs(b.corr))
                    .slice(0, 5)
                    .map((c) => (
                      <li key={c.pair} className="flex items-center justify-between gap-3">
                        <span className="truncate">{c.pair}</span>
                        <span className="text-gray-400">{c.corr >= 0 ? "+" : ""}{c.corr.toFixed(3)}</span>
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          </div>
          <div className="bg-[#0a0d12] border border-gray-800 rounded-xl p-4">
            <div className="text-sm font-semibold text-gray-200 mb-2 flex items-center gap-2"><ListOrdered className="w-4 h-4"/> Chi-square (Top 5)</div>
            <div className="text-xs text-gray-400 mb-2">Higher statistic suggests stronger dependence between categorical columns.</div>
            <div className="max-h-56 overflow-auto text-sm">
              <table className="w-full">
                <thead>
                  <tr className="text-gray-400 text-xs border-b border-gray-800">
                    <th className="text-left py-2 pr-2">Pair</th>
                    <th className="text-right py-2">Chi²</th>
                    <th className="text-right py-2">df</th>
                  </tr>
                </thead>
                <tbody>
                  {chiSquarePairs.slice(0, 5).map((c) => (
                    <tr key={c.pair} className="border-b border-gray-900/60">
                      <td className="py-2 pr-2 text-gray-100">{c.pair}</td>
                      <td className="py-2 text-right text-gray-300">{c.chi2.toFixed(2)}</td>
                      <td className="py-2 text-right text-gray-300">{c.df}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Section>

      {/* Outliers */}
      <Section icon={<ScanSearch className="w-5 h-5 text-rose-300" />} title="Outlier & Anomaly Summary" subtitle="Counts per numeric column using Z-score and IQR">
        <div className="overflow-auto max-h-96 text-xs md:text-sm">
          <table className="w-full">
            <thead>
              <tr className="text-gray-400 text-xs border-b border-gray-800">
                <th className="text-left py-2 pr-2">Column</th>
                <th className="text-right py-2">Z-score Count</th>
                <th className="text-right py-2">IQR Count</th>
                <th className="text-right py-2">IQR Fences</th>
              </tr>
            </thead>
            <tbody>
              {outliersByNumeric.map((o) => (
                <tr key={o.column} className="border-b border-gray-900/60">
                  <td className="py-2 pr-2 text-gray-100">{o.column}</td>
                  <td className="py-2 text-right text-gray-300">{o.zCount}</td>
                  <td className="py-2 text-right text-gray-300">{o.iqrCount}</td>
                  <td className="py-2 text-right text-gray-300">[{fmt(o.iqrFences[0])}, {fmt(o.iqrFences[1])}]</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Text Analytics */}
      {textStats.length > 0 && (
        <Section icon={<FileSearch className="w-5 h-5 text-yellow-300" />} title="Text Columns (Quick Stats)" subtitle="Average length and most frequent tokens">
          <div className="overflow-auto max-h-96 text-xs md:text-sm">
            <table className="w-full">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-gray-800">
                  <th className="text-left py-2 pr-2">Column</th>
                  <th className="text-right py-2">Avg Words</th>
                  <th className="text-left py-2">Top Words</th>
                </tr>
              </thead>
              <tbody>
                {textStats.map((t) => (
                  <tr key={t.column} className="border-b border-gray-900/60">
                    <td className="py-2 pr-2 text-gray-100">{t.column}</td>
                    <td className="py-2 text-right text-gray-300">{t.avgWords.toFixed(2)}</td>
                    <td className="py-2 text-gray-300">
                      {t.topWords.map((w) => (
                        <span key={w.token} className="inline-block mr-2 mb-1 px-2 py-0.5 rounded bg-gray-900/80 border border-gray-800 text-xs">
                          {w.token} <span className="text-gray-400">({w.count})</span>
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Insights */}
      <Section icon={<CheckCircle2 className="w-5 h-5 text-teal-300" />} title="Auto Insights" subtitle="Plain-language findings and suggestions">
        {insights.length ? (
          <ul className="text-sm text-gray-200 space-y-2">
            {insights.map((s, i) => (
              <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2, delay: i * 0.03 }} className="flex items-start gap-2">
                <span className="mt-[3px]">•</span>
                <span>{s}</span>
              </motion.li>
            ))}
          </ul>
        ) : (
          <div className="text-gray-400">No notable issues detected. Dataset looks healthy.</div>
        )}
      </Section>
    </div>
  );
};

// Small inline Calendar icon to avoid extra imports if not available in your icon set
const CalendarIcon: React.FC = () => (
  <svg className="w-4 h-4 text-gray-300" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M7 2v3M17 2v3M3 9h18M5 22h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export default AnalyticsTextReport;
