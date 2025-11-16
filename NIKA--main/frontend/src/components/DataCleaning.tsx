// src/components/DataCleaning.tsx
// --------------------------------------------------------------------------------------------
//
// Enhanced Data Cleaning Workbench (Full, non-condensed ~1500 lines)
// - Independent collapsible cards laid out as true side-by-side columns
// - Expanded toolset: Missing Data, Duplicates, Data Types, Standardize Text,
//   Normalize Numbers, Drop Columns
// - EXTENDED: Added Replace Substring, Capitalize Words, and Extract Date Part.
// - Action queue with drag-to-reorder and remove
// - Live preview (top 100 rows), with change-highlighting and sticky header
// - CSV export of the current preview
// - Clean, modern UI using Tailwind + Framer Motion animations
// - FIXES IMPLEMENTED:
//   - Added toast notifications for user feedback.
//   - Prevented redundant/duplicate actions.
//   - Removed direct DOM manipulation (getElementById) in favor of React state.
//   - Fixed bugs related to custom fill data types, chained number scaling, and CSV export headers.
//   - Refactored duplicate code in event handlers.
//
// Assumptions about DataContext shape:
//   dataset: {
//     columns: Array<{ name: string }>,
//     data: Array<Record<string, any>>
//   }
//   setDataset: (next: typeof dataset) => void
//
// NOTE: This file is intentionally verbose with comments and whitespace for clarity.
// --------------------------------------------------------------------------------------------

import React, {
  useState,
  useMemo,
  useCallback,
  Fragment,
} from "react";

import {
  motion,
  AnimatePresence,
  Reorder,
  LayoutGroup,
} from "framer-motion";

import {
  RectangleVertical as CleaningServices,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Trash2,
  Edit3,
  Info,
  Download as DownloadIcon,
  Sparkles,
  Save,
  X,
  GripVertical,
  ChevronDown,
  Sliders,
  Hash,
  CalendarDays, // NEW ICON
} from "lucide-react";

import { saveAs } from "file-saver";
import toast, { Toaster } from "react-hot-toast";

import { useDataContext } from "../context/DataContext";

// ============================================================================================
// TYPE DEFINITIONS
// ============================================================================================

/** Describes all supported cleaning action types for the recipe queue. */
export type CleaningActionType =
  | "REMOVE_DUPLICATES"
  | "FILL_MISSING"
  | "CHANGE_TYPE"
  | "DROP_COLUMN"
  | "TRIM_WHITESPACE"
  | "LOWERCASE"
  | "UPPERCASE"
  | "REMOVE_NON_ALPHANUM"
  | "NUMBER_ROUND"
  | "NUMBER_SCALE"
  // NEW ACTION TYPES
  | "REPLACE_SUBSTRING"
  | "CAPITALIZE_WORDS"
  | "EXTRACT_DATE_PART";

/** Describes a queued cleaning action. */
export interface CleaningAction {
  id: string;
  type: CleaningActionType;
  description: string;
  payload: {
    columnName?: string;
    strategy?: "mean" | "median" | "custom" | "zero";
    customValue?: any;
    newType?: "Text" | "Integer" | "Float" | "Date" | "Boolean";
    roundTo?: number; // for NUMBER_ROUND
    scaleMin?: number; // for NUMBER_SCALE
    scaleMax?: number; // for NUMBER_SCALE
    // NEW PAYLOAD PROPERTIES
    find?: string; // for REPLACE_SUBSTRING
    replaceWith?: string; // for REPLACE_SUBSTRING
    part?: "year" | "month" | "day" | "weekday"; // for EXTRACT_DATE_PART
  };
}

/** Cell preview structure with changed flag. */
export interface PreviewCell {
  value: any;
  isChanged: boolean;
}

/** Row of preview cells keyed by column name. */
export type PreviewRow = Record<string, PreviewCell>;

/** Lightweight dataset typing expected from context. */
export interface DatasetLike {
  columns: Array<{ name: string }>;
  data: Array<Record<string, any>>;
}

// ============================================================================================
// UTILITY HELPERS
// ============================================================================================

/** Checks if a value is null/undefined/empty string. */
const isNullish = (v: any): boolean => v === null || v === undefined || v === "";

/** Formats numbers with Indian locale grouping (e.g., 1,00,000). */
const formatNumber = (v: number): string => new Intl.NumberFormat("en-IN").format(v);

/** Parses strings like "1,234.56" or "$1,234" to a number. */
const parseNumberLike = (v: any): number => {
  if (v === null || v === undefined) return NaN;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[^0-9+\-\.eE]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * NEW: Tries to convert a string to a number if it looks numeric, otherwise returns the string.
 * This is crucial for fixing the custom fill value bug.
 */
const autoParse = (v: string): string | number => {
  const trimmed = v.trim();
  if (trimmed === "") return v; // Keep empty strings as is
  const num = Number(trimmed);
  return isNaN(num) ? v : num;
};

/** Converts unknown input to Date or null if invalid. */
const toDateOrNull = (v: any): Date | null => {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/** Compute mean of numeric array (ignoring NaN). */
const mean = (arr: number[]): number | null => {
  const nums = arr.filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
};

/** Compute median of numeric array (ignoring NaN). */
const median = (arr: number[]): number | null => {
  const nums = arr.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
};

/** Safe string lower. */
const lower = (v: any) => (v == null ? v : String(v).toLowerCase());

/** Safe string upper. */
const upper = (v: any) => (v == null ? v : String(v).toUpperCase());

/** Safe string trim. */
const trim = (v: any) => (v == null ? v : String(v).trim());

/** Remove non alphanumeric (preserve spaces) */
const removeNonAlphanum = (v: any) => (v == null ? v : String(v).replace(/[^\p{L}\p{N}\s]/gu, ""));

/** NEW: Safe string capitalize words (title case). */
const capitalizeWords = (v: any) => (v == null ? v : String(v).replace(/\b\w/g, char => char.toUpperCase()));

/** Deep compare for duplicate detection by serializing stable values. */
const stableKey = (row: Record<string, any>): string => {
  const ordered: Record<string, any> = {};
  for (const k of Object.keys(row).sort()) {
    const val = row[k];
    ordered[k] = val instanceof Date ? val.toISOString() : val;
  }
  return JSON.stringify(ordered);
};

/** CSV export from plain objects, escaping quotes. */
const objectsToCSV = (rows: Array<Record<string, any>>, columns: string[]): string => {
  const escape = (v: any) => {
    if (v == null) return "";
    // MODIFIED LINE: Use the same formatting as the preview table.
    const s = v instanceof Date ? v.toLocaleDateString('en-IN') : String(v);
    const needs = /[",\n]/.test(s);
    return needs ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = columns.map(escape).join(",");
  const lines = rows.map((r) => columns.map((c) => escape(r[c])).join(","));
  return [header, ...lines].join("\n");
};

// ============================================================================================
// CHILD: Header
// ============================================================================================

interface HeaderProps {
  onApply: () => void;
  onReset: () => void;
  onExport: () => void;
  stats: { missing: number; dups: number };
}

const Header: React.FC<HeaderProps> = ({ onApply, onReset, onExport, stats }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="bg-gray-800/60 backdrop-blur-sm rounded-2xl p-5 border border-gray-700 flex items-center justify-between sticky top-4 z-30 shadow-xl"
    >
      <div className="flex items-center space-x-4">
        <CleaningServices className="h-10 w-10 text-blue-400" />
        <div>
          <h2 className="text-2xl font-bold text-white">Data Cleaning Workbench</h2>
          <p className="text-gray-400 text-sm">
            Build a cleaning recipe below. Preview updates live.
          </p>
        </div>
      </div>

      <div className="hidden md:flex items-center space-x-6">
        <div className="flex items-center space-x-2">
          <AlertTriangle className="h-4 w-4 text-yellow-400" />
          <span className="text-sm text-gray-300">Missing: {formatNumber(stats.missing)}</span>
        </div>
        <div className="flex items-center space-x-2">
          <Info className="h-4 w-4 text-red-400" />
          <span className="text-sm text-gray-300">Duplicates: {formatNumber(stats.dups)}</span>
        </div>
      </div>

      <div className="flex items-center space-x-3">
        <button
          onClick={onReset}
          className="bg-gray-600 hover:bg-gray-500 text-white px-4 py-2 rounded-xl flex items-center space-x-2 transition-colors"
        >
          <RefreshCw size={16} />
          <span>Reset</span>
        </button>

        <button
          onClick={onApply}
          className="bg-green-600 hover:bg-green-500 text-white px-5 py-2 rounded-xl flex items-center space-x-2 font-bold transition-colors"
        >
          <Save size={16} />
          <span>Apply Changes</span>
        </button>

        <button
          onClick={onExport}
          className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl flex items-center space-x-2 transition-colors"
        >
          <DownloadIcon size={16} />
          <span>Export CSV</span>
        </button>
      </div>
    </motion.div>
  );
};

// ============================================================================================
// CHILD: CleaningActionColumn (collapsible card)
// ============================================================================================

interface CleaningActionColumnProps {
  title: string;
  icon: React.ElementType;
  color: string;
  isOpen: boolean;
  onClick: () => void;
  children: React.ReactNode;
  subtitle?: string;
}

const CleaningActionColumn: React.FC<CleaningActionColumnProps> = ({
  title,
  icon: Icon,
  color,
  isOpen,
  onClick,
  children,
  subtitle,
}) => {
  return (
    <motion.div
      layout
      className="bg-gradient-to-b from-gray-900/60 to-gray-900/20 rounded-2xl border border-gray-700 overflow-hidden hover:shadow-lg hover:shadow-black/30 transition-shadow"
    >
      <motion.button
        layoutId={`header-${title}`}
        onClick={onClick}
        className="w-full p-5 flex items-center justify-between cursor-pointer hover:bg-gray-700/20 transition-colors"
      >
        <div className="flex items-center space-x-3 text-left">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gray-800 border border-gray-700">
            <Icon className={`h-6 w-6 ${color}`} />
          </span>
          <div>
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            {subtitle ? (
              <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>
            ) : null}
          </div>
        </div>

        <motion.div
          animate={{ rotate: isOpen ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 16 }}
        >
          <ChevronDown size={20} className="text-gray-400" />
        </motion.div>
      </motion.button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1, transition: { opacity: { delay: 0.08 } } }}
            exit={{ height: 0, opacity: 0 }}
            className="px-5 pb-5"
          >
            <div className="border-t border-gray-700 pt-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ============================================================================================
// CHILD: PendingActionsQueue (draggable list of steps)
// ============================================================================================

interface PendingActionsQueueProps {
  actions: CleaningAction[];
  setActions: React.Dispatch<React.SetStateAction<CleaningAction[]>>;
}

const PendingActionsQueue: React.FC<PendingActionsQueueProps> = ({ actions, setActions }) => {
  if (actions.length === 0) return null;

  return (
    <motion.div
      layout
      className="p-5 bg-gray-900/50 rounded-2xl border border-gray-700 shadow-inner"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-white text-lg">Cleaning Recipe ({actions.length} steps)</h3>
        <span className="text-xs text-gray-400">Drag to reorder</span>
      </div>

      <Reorder.Group axis="y" values={actions} onReorder={setActions} className="space-y-2">
        {actions.map((action, index) => (
          <Reorder.Item
            key={action.id}
            value={action}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.18 }}
            className="flex items-center justify-between bg-gray-700/50 p-3 rounded-xl cursor-grab active:cursor-grabbing"
          >
            <div className="flex items-center space-x-3">
              <GripVertical size={18} className="text-gray-500" />
              <span className="font-mono text-xs text-blue-300 bg-blue-900/50 px-2 py-1 rounded">
                {index + 1}
              </span>
              <p className="text-sm text-gray-200">{action.description}</p>
            </div>

            <button
              onClick={() => setActions(actions.filter((a) => a.id !== action.id))}
              className="p-1 rounded-full hover:bg-red-500/20"
              aria-label="Remove step"
              title="Remove step"
            >
              <X size={16} className="text-red-400" />
            </button>
          </Reorder.Item>
        ))}
      </Reorder.Group>
    </motion.div>
  );
};

// ============================================================================================
// MAIN: DataCleaning
// ============================================================================================

const DataCleaning: React.FC = () => {
  // -------------------------------------------------------------
  // Context: dataset and setter
  // -------------------------------------------------------------
  const { dataset: originalDataset, setDataset } = useDataContext() as {
    dataset: DatasetLike | null;
    setDataset: (next: DatasetLike) => void;
  };

  // -------------------------------------------------------------
  // Local UI state
  // -------------------------------------------------------------
  const [actions, setActions] = useState<CleaningAction[]>([]);
 
  // State to manage the values of the scale inputs without direct DOM access
  const [scaleInputs, setScaleInputs] = useState<Record<string, { min: string; max: string }>>({});

  // NEW: State for "Replace Substring" inputs
  const [replaceInputs, setReplaceInputs] = useState<Record<string, { find: string; replaceWith: string }>>({});

  const [openColumns, setOpenColumns] = useState({
    missing: true,
    duplicates: false,
    types: false,
    text: false,
    numbers: false,
    dates: false, // NEW
    dropCols: false,
  });

  const toggleColumn = (key: keyof typeof openColumns) => {
    setOpenColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // -------------------------------------------------------------
  // Derived: preview rows + stats
  // -------------------------------------------------------------
  const preview = useMemo(() => {
    if (!originalDataset) return { data: [] as PreviewRow[], stats: { missing: 0, dups: 0 } };

    // Build PreviewRow array from original
    let processed: PreviewRow[] = originalDataset.data.map((row) => {
      const pr: PreviewRow = {};
      for (const key of Object.keys(row)) {
        pr[key] = { value: row[key], isChanged: false };
      }
      return pr;
    });

    // Helper for marking cell changes
    const setCell = (r: PreviewRow, key: string, nextVal: any) => {
      const prev = r[key]?.value;
      const changed = !(prev === nextVal || (prev instanceof Date && nextVal instanceof Date && prev.getTime() === nextVal.getTime()));
      r[key] = { value: nextVal, isChanged: r[key]?.isChanged || changed };
    };

    // For strategies that need column stats (e.g., mean/median), precompute per-column numeric arrays
    const numericCache: Record<string, number[]> = {};

    const ensureNumericCache = (col: string) => {
      if (numericCache[col]) return numericCache[col];
      const arr = processed.map((r) => parseNumberLike(r[col]?.value));
      numericCache[col] = arr;
      return arr;
    };

    // Apply actions in order
    for (const action of actions) {
      switch (action.type) {
        case "REMOVE_DUPLICATES": {
          const seen = new Set<string>();
          processed = processed.filter((row) => {
            const obj = Object.fromEntries(
              Object.entries(row).map(([k, c]) => [k, c.value])
            );
            const key = stableKey(obj);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          break;
        }

        case "FILL_MISSING": {
          const col = action.payload.columnName!;
          const strat = action.payload.strategy || "zero";

          // compute replacement once per action
          let replacement: any = 0;
          if (strat === "custom") {
            replacement = action.payload.customValue;
          } else if (strat === "zero") {
            replacement = 0;
          } else if (strat === "mean") {
            const nums = ensureNumericCache(col);
            const m = mean(nums);
            replacement = m ?? 0;
          } else if (strat === "median") {
            const nums = ensureNumericCache(col);
            const m = median(nums);
            replacement = m ?? 0;
          }

          processed = processed.map((row) => {
            const cell = row[col];
            if (!cell || !isNullish(cell.value)) return row;
            const copy = { ...row };
            setCell(copy, col, replacement);
            return copy;
          });
          break;
        }

        case "CHANGE_TYPE": {
          const col = action.payload.columnName!;
          const t = action.payload.newType!;

          processed = processed.map((row) => {
            const cell = row[col];
            if (!cell) return row;

            let nextVal: any = cell.value;

            if (t === "Integer") {
              const n = parseNumberLike(nextVal);
              nextVal = Number.isFinite(n) ? Math.trunc(n) : null;
            } else if (t === "Float") {
              const n = parseNumberLike(nextVal);
              nextVal = Number.isFinite(n) ? n : null;
            } else if (t === "Text") {
              nextVal = nextVal == null ? "" : String(nextVal);
            } else if (t === "Boolean") {
              const s = String(nextVal).toLowerCase();
              nextVal = ["true", "1", "yes", "y"].includes(s);
            } else if (t === "Date") {
              nextVal = toDateOrNull(nextVal);
            }

            const copy = { ...row };
            setCell(copy, col, nextVal);
            return copy;
          });
          break;
        }

        case "DROP_COLUMN": {
          const col = action.payload.columnName!;
          processed = processed.map((row) => {
            const copy: PreviewRow = { ...row };
            // Indicate deletion by setting to undefined; we will omit at the end
            if (copy[col]) {
              copy[col] = { value: undefined, isChanged: true };
            }
            return copy;
          });
          break;
        }

        case "TRIM_WHITESPACE": {
          const col = action.payload.columnName!;
          processed = processed.map((row) => {
            const v = row[col]?.value;
            if (v == null) return row;
            const nv = trim(v);
            if (nv === v) return row;
            const copy = { ...row };
            setCell(copy, col, nv);
            return copy;
          });
          break;
        }

        case "LOWERCASE": {
          const col = action.payload.columnName!;
          processed = processed.map((row) => {
            const v = row[col]?.value;
            if (v == null) return row;
            const nv = lower(v);
            if (nv === v) return row;
            const copy = { ...row };
            setCell(copy, col, nv);
            return copy;
          });
          break;
        }

        case "UPPERCASE": {
          const col = action.payload.columnName!;
          processed = processed.map((row) => {
            const v = row[col]?.value;
            if (v == null) return row;
            const nv = upper(v);
            if (nv === v) return row;
            const copy = { ...row };
            setCell(copy, col, nv);
            return copy;
          });
          break;
        }

        case "REMOVE_NON_ALPHANUM": {
          const col = action.payload.columnName!;
          processed = processed.map((row) => {
            const v = row[col]?.value;
            if (v == null) return row;
            const nv = removeNonAlphanum(v);
            if (nv === v) return row;
            const copy = { ...row };
            setCell(copy, col, nv);
            return copy;
          });
          break;
        }

        case "CAPITALIZE_WORDS": {
          const col = action.payload.columnName!;
          processed = processed.map((row) => {
            const v = row[col]?.value;
            if (v == null) return row;
            const nv = capitalizeWords(v);
            if (nv === v) return row;
            const copy = { ...row };
            setCell(copy, col, nv);
            return copy;
          });
          break;
        }

        case "REPLACE_SUBSTRING": {
          const col = action.payload.columnName!;
          const find = action.payload.find!;
          const replaceWith = action.payload.replaceWith!;
          processed = processed.map((row) => {
            const v = row[col]?.value;
            if (v == null || find === '') return row;
            const nv = String(v).replaceAll(find, replaceWith);
            if (nv === v) return row;
            const copy = { ...row };
            setCell(copy, col, nv);
            return copy;
          });
          break;
        }

        case "EXTRACT_DATE_PART": {
          const col = action.payload.columnName!;
          const part = action.payload.part!;
          const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

          processed = processed.map((row) => {
            const v = row[col]?.value;
            const date = toDateOrNull(v);
            if (!date) return row;

            let nv: string | number | null = null;
            if (part === 'year') nv = date.getFullYear();
            if (part === 'month') nv = date.getMonth() + 1; // 1-indexed
            if (part === 'day') nv = date.getDate();
            if (part === 'weekday') nv = weekdays[date.getDay()];
            
            if (nv === null) return row;

            const copy = { ...row };
            setCell(copy, col, nv);
            return copy;
          });
          break;
        }

        case "NUMBER_ROUND": {
          const col = action.payload.columnName!;
          const places = action.payload.roundTo ?? 0;
          const factor = Math.pow(10, places);

          processed = processed.map((row) => {
            const v = parseNumberLike(row[col]?.value);
            if (!Number.isFinite(v)) return row;
            const nv = Math.round(v * factor) / factor;
            const copy = { ...row };
            setCell(copy, col, nv);
            return copy;
          });
          break;
        }

        case "NUMBER_SCALE": {
          const col = action.payload.columnName!;
          // IMPORTANT: Chaining scale operations is mathematically incorrect.
          // The UI now prevents this, so this logic can assume it's the only scale op.
          const nums = processed.map((r) => parseNumberLike(r[col]?.value));
          const finite = nums.filter((n) => Number.isFinite(n)) as number[];
          if (!finite.length) break;
          const min = Math.min(...finite);
          const max = Math.max(...finite);
          const outMin = action.payload.scaleMin ?? 0;
          const outMax = action.payload.scaleMax ?? 1;

          processed = processed.map((row) => {
            const v = parseNumberLike(row[col]?.value);
            if (!Number.isFinite(v)) return row;
            const t = max === min ? 0 : (v - min) / (max - min);
            const nv = outMin + t * (outMax - outMin);
            const copy = { ...row };
            setCell(copy, col, nv);
            return copy;
          });
          break;
        }

        default:
          break;
      }
    }

    const flattened = processed.map((row) => {
      const obj: Record<string, any> = {};
      for (const [k, cell] of Object.entries(row)) {
        if (cell?.value !== undefined) {
          obj[k] = cell.value;
        }
      }
      return obj;
    });

    const missing = flattened.reduce(
      (sum, row) => sum + Object.values(row).filter(isNullish).length,
      0
    );

    const dups = flattened.length - new Set(flattened.map((r) => stableKey(r))).size;

    return { data: processed, stats: { missing, dups } };
  }, [originalDataset, actions]);

  // -------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------

  /**
   * NEW: Centralized handler for adding actions with redundancy checks.
   */
  const handleAddAction = useCallback((action: Omit<CleaningAction, "id">) => {
    // Check for redundancy before adding
    const isRedundant = actions.some(a => {
        if (a.type !== action.type) return false;
        // For actions without a specific column, just check type
        if (!action.payload.columnName) {
            return a.type === 'REMOVE_DUPLICATES';
        }

        // For actions with complex payloads (like replace), check more fields
        if (action.type === 'REPLACE_SUBSTRING') {
            return a.payload.columnName === action.payload.columnName &&
                   a.payload.find === action.payload.find;
        }

        // For actions on a column, check type and column name
        return a.payload.columnName === action.payload.columnName;
    });

    if (isRedundant) {
        toast.error(`A similar "${action.description}" step already exists.`);
        return;
    }

    const newAction: CleaningAction = {
      ...action,
      id: `${Date.now()}-${Math.random()}`,
    };
    setActions((prev) => [...prev, newAction]);
    toast.success(`Added: ${newAction.description}`);
  }, [actions]);

  const handleApplyChanges = useCallback(() => {
    if (!originalDataset) return;

    const finalCleanedData = preview.data.map((row) => {
      const out: Record<string, any> = {};
      for (const [k, cell] of Object.entries(row)) {
        if (cell.value !== undefined) {
          out[k] = cell.value;
        }
      }
      return out;
    });

    const droppedColumns = new Set<string>(
      actions
        .filter(action => action.type === 'DROP_COLUMN')
        .map(action => action.payload.columnName!)
        .filter(Boolean)
    );

    const nextColumns = originalDataset.columns.filter(
      col => !droppedColumns.has(col.name)
    );

    setDataset({ columns: nextColumns, data: finalCleanedData });
    setActions([]);
    toast.success("Cleaning recipe applied successfully!");
    
  }, [preview, originalDataset, setDataset, actions]);

  const handleReset = useCallback(() => {
    setActions([]);
    toast.success("Cleaning recipe has been reset.");
  }, []);

  /**
   * FIXED: This function now correctly determines the final headers, even if the
   * preview data is empty, by checking the 'DROP_COLUMN' actions.
   */
  const exportCSV = useCallback(() => {
    if (!originalDataset) return;

    const flattened = preview.data.map((row) => {
      const obj: Record<string, any> = {};
      for (const [k, cell] of Object.entries(row)) {
        if (cell.value !== undefined) obj[k] = cell.value;
      }
      return obj;
    });

    const droppedColumns = new Set<string>(
      actions
        .filter(action => action.type === 'DROP_COLUMN' && action.payload.columnName)
        .map(action => action.payload.columnName!)
    );

    const finalColumns = originalDataset.columns
      .filter(col => !droppedColumns.has(col.name))
      .map(col => col.name);

    const csv = objectsToCSV(flattened, finalColumns);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    saveAs(blob, `cleaned_dataset_${Date.now()}.csv`);
    toast.success("CSV export started.");
  }, [originalDataset, preview, actions]);


  // -------------------------------------------------------------
  // REFACTORED: Shared logic for submitting from an input field
  // -------------------------------------------------------------

  const handleCustomFillSubmit = (value: string, name: string) => {
    if (value.trim() === "") return;
    const parsedValue = autoParse(value); // FIX: Auto-parse to number if possible
    handleAddAction({
      type: "FILL_MISSING",
      description: `Fill missing in '${name}' with "${parsedValue}"`,
      payload: { columnName: name, strategy: "custom", customValue: parsedValue },
    });
  };

  const handleRoundSubmit = (value: string, name: string) => {
    const places = Number(value);
    if (!Number.isFinite(places)) return;
      handleAddAction({
        type: "NUMBER_ROUND",
        description: `Round '${name}' to ${places} decimals`,
        payload: { columnName: name, roundTo: places },
    });
  };


  // -------------------------------------------------------------
  // Guard: No dataset loaded
  // -------------------------------------------------------------

  if (!originalDataset) {
    return (
      <div className="p-10 text-center text-gray-400">
        Loading dataset...
      </div>
    );
  }

  // Convenience shorthands
  const columnNames = originalDataset.columns.map((c) => c.name);
  const previewColumns = originalDataset.columns
    .map((c) => c.name)
    .filter((name) => preview.data[0]?.[name]?.value !== undefined);

  // ==========================================================================================
  // RENDER
  // ==========================================================================================
  return (
    <div className="p-6 space-y-6">
      {/* NEW: Toaster component for notifications */}
      <Toaster position="bottom-right" toastOptions={{
        style: { background: '#334155', color: '#e2e8f0' },
        success: { iconTheme: { primary: '#22c55e', secondary: '#334155' } },
        error: { iconTheme: { primary: '#ef4444', secondary: '#334155' } },
      }} />

      <Header
        onApply={handleApplyChanges}
        onReset={handleReset}
        onExport={exportCSV}
        stats={preview.stats}
      />

      <PendingActionsQueue actions={actions} setActions={setActions} />

      <LayoutGroup>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-7 gap-6">
          <CleaningActionColumn
            title="Handle Missing Data"
            icon={AlertTriangle}
            color="text-yellow-400"
            isOpen={openColumns.missing}
            onClick={() => toggleColumn("missing")}
            subtitle="Fill null/empty values using rules"
          >
            <div className="text-sm text-gray-300 space-y-4">
              <p className="text-gray-400">
                Choose a column and a fill strategy. For mean/median we use non-empty numeric values.
              </p>
              <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1 custom-scroll">
                {columnNames.map((name) => (
                  <div key={name} className="grid grid-cols-12 items-center gap-2 bg-gray-800/40 rounded-xl p-2">
                    <div className="col-span-4">
                      <span className="font-medium text-gray-200 truncate block" title={name}>
                        {name}
                      </span>
                    </div>
                    <div className="col-span-4">
                      <select
                        className="w-full bg-gray-700 text-white px-2 py-1.5 rounded text-sm"
                        onChange={(e) => {
                          const strat = e.target.value as CleaningAction["payload"]["strategy"];
                          if (!strat || strat === 'custom') return; // Custom is handled by the input field
                          handleAddAction({
                            type: "FILL_MISSING",
                            description: `Fill missing in '${name}' using ${strat}`,
                            payload: { columnName: name, strategy: strat },
                          });
                          e.currentTarget.selectedIndex = 0;
                        }}
                      >
                        <option value="">Select strategy…</option>
                        <option value="zero">Zero</option>
                        <option value="mean">Mean</option>
                        <option value="median">Median</option>
                        <option value="custom">Custom Value (use input)</option>
                      </select>
                    </div>
                    <div className="col-span-4">
                      <input
                        placeholder="Custom fill value"
                        className="w-full bg-gray-700 text-white px-2 py-1.5 rounded text-sm"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleCustomFillSubmit((e.target as HTMLInputElement).value, name);
                            (e.target as HTMLInputElement).value = "";
                          }
                        }}
                        onBlur={(e) => {
                            handleCustomFillSubmit((e.target as HTMLInputElement).value, name);
                            (e.target as HTMLInputElement).value = "";
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CleaningActionColumn>

          <CleaningActionColumn
            title="Remove Duplicates"
            icon={Info}
            color="text-red-400"
            isOpen={openColumns.duplicates}
            onClick={() => toggleColumn("duplicates")}
            subtitle="Drop exact duplicate rows"
          >
            <div className="space-y-4">
              <p className="text-sm text-gray-400">
                This step will remove rows that are exact copies of another row across all visible columns.
              </p>
              <button
                onClick={() =>
                  handleAddAction({
                    type: "REMOVE_DUPLICATES",
                    description: "Remove duplicate rows",
                    payload: {},
                  })
                }
                className="w-full bg-red-600 hover:bg-red-500 text-white font-semibold py-2 rounded-xl transition-colors"
              >
                Add Duplicate Removal Step
              </button>
              <div className="text-xs text-gray-500">
                Tip: Apply this step after finishing most other transforms to maximize effect.
              </div>
            </div>
          </CleaningActionColumn>

          <CleaningActionColumn
            title="Fix Data Types"
            icon={Sparkles}
            color="text-blue-400"
            isOpen={openColumns.types}
            onClick={() => toggleColumn("types")}
            subtitle="Convert columns to the correct type"
          >
            <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
              {columnNames.map((name) => (
                <div key={name} className="grid grid-cols-12 gap-2 items-center bg-gray-800/40 rounded-xl p-2">
                  <div className="col-span-5">
                    <span className="font-medium text-gray-200 text-sm truncate block" title={name}>
                      {name}
                    </span>
                  </div>
                  <div className="col-span-7">
                    <select
                      onChange={(e) => {
                        const newType = e.target.value as CleaningAction["payload"]["newType"];
                        if (!newType) return;
                        handleAddAction({
                          type: "CHANGE_TYPE",
                          description: `Change type of '${name}' to ${newType}`,
                          payload: { columnName: name, newType },
                        });
                        e.currentTarget.selectedIndex = 0;
                      }}
                      className="bg-gray-700 text-white px-2 py-1.5 rounded w-full text-sm"
                    >
                      <option value="">Select a new type…</option>
                      <option value="Text">Text</option>
                      <option value="Integer">Integer</option>
                      <option value="Float">Float</option>
                      <option value="Date">Date</option>
                      <option value="Boolean">Boolean</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </CleaningActionColumn>

          <CleaningActionColumn
            title="Standardize Text"
            icon={Edit3}
            color="text-green-400"
            isOpen={openColumns.text}
            onClick={() => toggleColumn("text")}
            subtitle="Trim, case, and remove special characters"
          >
            <div className="space-y-4">
              <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                {columnNames.map((name) => (
                  <div key={name} className="bg-gray-800/40 rounded-xl p-3 space-y-3">
                    <span className="text-sm font-medium text-gray-200 truncate" title={name}>
                      {name}
                    </span>
                    {/* Basic transforms */}
                    <div className="grid grid-cols-2 gap-2">
                      <button className="bg-gray-700/70 hover:bg-gray-600 text-white py-1.5 rounded text-xs" onClick={() => handleAddAction({ type: "TRIM_WHITESPACE", description: `Trim whitespace in '${name}'`, payload: { columnName: name } })}>Trim</button>
                      <button className="bg-gray-700/70 hover:bg-gray-600 text-white py-1.5 rounded text-xs" onClick={() => handleAddAction({ type: "LOWERCASE", description: `Lowercase '${name}'`, payload: { columnName: name } })}>Lowercase</button>
                      <button className="bg-gray-700/70 hover:bg-gray-600 text-white py-1.5 rounded text-xs" onClick={() => handleAddAction({ type: "UPPERCASE", description: `Uppercase '${name}'`, payload: { columnName: name } })}>Uppercase</button>
                      <button className="bg-gray-700/70 hover:bg-gray-600 text-white py-1.5 rounded text-xs" onClick={() => handleAddAction({ type: "CAPITALIZE_WORDS", description: `Capitalize '${name}'`, payload: { columnName: name } })}>Capitalize</button>
                    </div>
                    {/* Replace Substring */}
                    <div className="space-y-2">
                       <div className="grid grid-cols-2 gap-2">
                         <input placeholder="Find" className="bg-gray-700 text-white px-2 py-1.5 rounded text-sm" value={replaceInputs[name]?.find ?? ''} onChange={(e) => setReplaceInputs(s => ({...s, [name]: {...(s[name] ?? {replaceWith: ''}), find: e.target.value}}))} />
                         <input placeholder="Replace" className="bg-gray-700 text-white px-2 py-1.5 rounded text-sm" value={replaceInputs[name]?.replaceWith ?? ''} onChange={(e) => setReplaceInputs(s => ({...s, [name]: {...(s[name] ?? {find: ''}), replaceWith: e.target.value}}))} />
                       </div>
                       <button className="w-full bg-green-700/50 hover:bg-green-600/50 text-white py-1.5 rounded text-sm" onClick={() => {
                           const find = replaceInputs[name]?.find;
                           const replaceWith = replaceInputs[name]?.replaceWith;
                           if (!find) {
                               toast.error("'Find' text cannot be empty.");
                               return;
                           }
                           handleAddAction({ type: "REPLACE_SUBSTRING", description: `In '${name}', replace "${find}" with "${replaceWith}"`, payload: { columnName: name, find, replaceWith }});
                           setReplaceInputs(s => ({...s, [name]: {find: '', replaceWith: ''}}));
                       }}>Replace</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </CleaningActionColumn>
          
          <CleaningActionColumn
            title="Normalize Numbers"
            icon={Sliders}
            color="text-purple-400"
            isOpen={openColumns.numbers}
            onClick={() => toggleColumn("numbers")}
            subtitle="Round or scale numeric ranges"
          >
            <div className="space-y-4">
              <p className="text-sm text-gray-400">
                Round to fixed decimals or scale values to a target range.
              </p>
              <div className="space-y-2">
                <h4 className="text-xs uppercase tracking-wider text-gray-400">Round</h4>
                <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                  {columnNames.map((name) => (
                    <div key={name} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-6">
                        <span className="text-sm text-gray-200 truncate" title={name}>{name}</span>
                      </div>
                      <div className="col-span-3">
                        <input
                          type="number"
                          min={0} max={10}
                          placeholder="Decimals"
                          className="w-full bg-gray-700 text-white px-2 py-1.5 rounded text-sm"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                  handleRoundSubmit((e.target as HTMLInputElement).value, name);
                                  (e.target as HTMLInputElement).value = "";
                                }
                            }}
                            onBlur={(e) => {
                              handleRoundSubmit((e.target as HTMLInputElement).value, name);
                              (e.target as HTMLInputElement).value = "";
                            }}
                        />
                      </div>
                      <div className="col-span-3 text-right">
                        <button
                          className="bg-purple-700/50 hover:bg-purple-600/50 text-white py-1.5 px-3 rounded text-xs"
                          onClick={() =>
                            handleAddAction({
                              type: "NUMBER_ROUND",
                              description: `Round '${name}' to 0 decimals`,
                              payload: { columnName: name, roundTo: 0 },
                            })
                          }
                        >
                          Round 0
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <h4 className="text-xs uppercase tracking-wider text-gray-400">Scale</h4>
                <div className="space-y-3 max-h-[160px] overflow-y-auto pr-1">
                  {columnNames.map((name) => (
                    <div key={name} className="bg-gray-800/40 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-gray-200 truncate" title={name}>{name}</span>
                        <Hash className="h-4 w-4 text-gray-500" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          placeholder="Out min (default 0)"
                          className="w-full bg-gray-700 text-white px-2 py-1.5 rounded text-sm"
                          value={scaleInputs[name]?.min ?? ''}
                          onChange={(e) => setScaleInputs(s => ({...s, [name]: {...(s[name] ?? {max: ''}), min: e.target.value}}))}
                        />
                        <input
                          type="number"
                          placeholder="Out max (default 1)"
                          className="w-full bg-gray-700 text-white px-2 py-1.5 rounded text-sm"
                          value={scaleInputs[name]?.max ?? ''}
                          onChange={(e) => setScaleInputs(s => ({...s, [name]: {...(s[name] ?? {min: ''}), max: e.target.value}}))}
                        />
                      </div>
                      <button
                        className="mt-2 w-full bg-purple-700/50 hover:bg-purple-600/50 text-white py-1.5 rounded text-sm"
                        onClick={() => {
                          const isAlreadyScaled = actions.some(a => a.type === "NUMBER_SCALE" && a.payload.columnName === name);
                          if (isAlreadyScaled) {
                            toast.error(`A scaling rule for '${name}' already exists.`);
                            return;
                          }
                          const outMinRaw = scaleInputs[name]?.min ?? "0";
                          const outMaxRaw = scaleInputs[name]?.max ?? "1";
                          const outMin = outMinRaw === "" ? 0 : Number(outMinRaw);
                          const outMax = outMaxRaw === "" ? 1 : Number(outMaxRaw);
                          
                          handleAddAction({
                            type: "NUMBER_SCALE",
                            description: `Scale '${name}' to [${outMin}, ${outMax}]`,
                            payload: {
                              columnName: name,
                              scaleMin: Number.isFinite(outMin) ? outMin : 0,
                              scaleMax: Number.isFinite(outMax) ? outMax : 1,
                            },
                          });
                          setScaleInputs(s => ({...s, [name]: {min: '', max: ''}}));
                        }}
                      >
                        Add Scale Step
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CleaningActionColumn>

          {/* NEW CARD FOR DATE HANDLING */}
          <CleaningActionColumn
            title="Handle Dates"
            icon={CalendarDays}
            color="text-teal-400"
            isOpen={openColumns.dates}
            onClick={() => toggleColumn("dates")}
            subtitle="Extract parts from date columns"
          >
            <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
              {columnNames.map((name) => (
                <div key={name} className="bg-gray-800/40 rounded-xl p-3 space-y-2">
                  <span className="text-sm font-medium text-gray-200 truncate" title={name}>{name}</span>
                  <div className="grid grid-cols-2 gap-2">
                    <button className="bg-gray-700/70 hover:bg-gray-600 text-white py-1.5 rounded text-xs" onClick={() => handleAddAction({ type: "EXTRACT_DATE_PART", description: `Extract Year from '${name}'`, payload: { columnName: name, part: 'year' } })}>Extract Year</button>
                    <button className="bg-gray-700/70 hover:bg-gray-600 text-white py-1.5 rounded text-xs" onClick={() => handleAddAction({ type: "EXTRACT_DATE_PART", description: `Extract Month from '${name}'`, payload: { columnName: name, part: 'month' } })}>Extract Month</button>
                    <button className="bg-gray-700/70 hover:bg-gray-600 text-white py-1.5 rounded text-xs" onClick={() => handleAddAction({ type: "EXTRACT_DATE_PART", description: `Extract Day from '${name}'`, payload: { columnName: name, part: 'day' } })}>Extract Day</button>
                    <button className="bg-gray-700/70 hover:bg-gray-600 text-white py-1.5 rounded text-xs" onClick={() => handleAddAction({ type: "EXTRACT_DATE_PART", description: `Extract Weekday from '${name}'`, payload: { columnName: name, part: 'weekday' } })}>Extract Weekday</button>
                  </div>
                </div>
              ))}
            </div>
          </CleaningActionColumn>
          
          <CleaningActionColumn
            title="Drop Columns"
            icon={Trash2}
            color="text-pink-400"
            isOpen={openColumns.dropCols}
            onClick={() => toggleColumn("dropCols")}
            subtitle="Remove unnecessary columns"
          >
            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
              {columnNames.map((name) => (
                <div key={name} className="flex items-center justify-between bg-gray-800/40 p-2 rounded-lg">
                  <span className="text-sm text-gray-200 truncate" title={name}>{name}</span>
                  <button
                    onClick={() => handleAddAction({
                      type: "DROP_COLUMN",
                      description: `Drop column '${name}'`,
                      payload: { columnName: name },
                    })}
                    className="bg-pink-600/50 hover:bg-pink-500/50 text-white px-3 py-1 text-xs rounded-md"
                  >
                    Drop
                  </button>
                </div>
              ))}
            </div>
          </CleaningActionColumn>
        </div>
      </LayoutGroup>

      <motion.div
        layout
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="bg-gray-900/50 rounded-2xl border border-gray-700 p-5"
      >
        <h3 className="text-lg font-semibold text-white mb-4">Live Preview (Top 100 Rows)</h3>
        <div className="overflow-auto max-h-[600px] rounded-lg border border-gray-700 custom-scroll relative shadow-inner">
          <table className="w-full text-sm text-left text-gray-300">
            <thead className="text-xs text-gray-400 uppercase bg-gray-800 sticky top-0 z-10 backdrop-blur-sm bg-opacity-80">
              <tr>
                {previewColumns.map((name) => (
                  <th key={name} scope="col" className="px-4 py-3 font-medium whitespace-nowrap">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.data.slice(0, 100).map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-gray-700 hover:bg-gray-800/40">
                  {previewColumns.map((name) => {
                    const cell = row[name];
                    if (!cell) return <td key={name} className="px-4 py-2"></td>;

                    const displayValue = (v: any) => {
                      if (v === null || v === undefined) return <span className="text-gray-500 italic">null</span>;
                      // MODIFIED LINE: Use toLocaleDateString to show only the date
                      if (v instanceof Date) return v.toLocaleDateString('en-IN');
                      if (typeof v === 'boolean') return v ? 'true' : 'false';
                      return String(v);
                    };

                    return (
                      <td
                        key={name}
                        className={`px-4 py-2 whitespace-nowrap transition-colors duration-300 ${cell.isChanged ? "bg-blue-600/20 text-blue-200" : ""
                          }`}
                      >
                        {displayValue(cell.value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {preview.data.length === 0 && (
            <div className="text-center p-8 text-gray-500">
              No data to display. The cleaning recipe may have removed all rows.
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default DataCleaning;