
import { Dataset, ColumnInfo, DataSummary, AIInsight } from '../types';
import Papa from 'papaparse';

// ===========================
// Math & Type Guards
// ===========================

export const isMissing = (v: any): boolean =>
  v === null ||
  v === undefined ||
  v === '' ||
  (typeof v === 'number' && Number.isNaN(v));

export const isFiniteNumber = (v: any): boolean => typeof v === 'number' && Number.isFinite(v);

export const toNumber = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

export const mean = (arr: number[]): number => {
  if (!arr || arr.length === 0) return 0;
  const s = arr.reduce((a, b) => a + b, 0);
  return s / arr.length;
};

export const median = (arr: number[]): number => {
  if (!arr || arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export const stdDev = (arr: number[]): number => {
  if (!arr || arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((acc, x) => acc + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
};

export const minMax = (arr: number[]): { min: number; max: number } => {
  if (!arr || arr.length === 0) return { min: 0, max: 0 };
  let mn = arr[0],
    mx = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const v = arr[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return { min: mn, max: mx };
};

export const pearson = (x: number[], y: number[]): number => {
    if (!x || !y) return 0;
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
        if (isFiniteNumber(x[i]) && isFiniteNumber(y[i])) {
            xs.push(x[i]);
            ys.push(y[i]);
        }
    }
    if (xs.length < 2) return 0;
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0,
        sx = 0,
        sy = 0;
    for (let i = 0; i < xs.length; i++) {
        num += (xs[i] - mx) * (ys[i] - my);
        sx += (xs[i] - mx) ** 2;
        sy += (ys[i] - my) ** 2;
    }
    const den = Math.sqrt(sx * sy);
    if (!isFiniteNumber(num) || !isFiniteNumber(den) || den === 0) return 0;
    return num / den;
};

export const zScoreOutliers = (arr: number[], thresh = 2.5): number[] => {
    if (!arr || arr.length < 2) return [];
    const m = mean(arr);
    const s = stdDev(arr);
    if (s === 0) return [];
    const idx: number[] = [];
    for (let i = 0; i < arr.length; i++) {
        const z = (arr[i] - m) / s;
        if (Math.abs(z) > thresh) idx.push(i);
    }
    return idx;
};

// ✅ Parse CSV file
export const parseCSV = (file: File): Promise<Record<string, any>[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          reject(new Error(`CSV parsing error: ${results.errors[0].message}`));
        } else {
          resolve(results.data as Record<string, any>[]);
        }
      },
      error: (error) => reject(error)
    });
  });
};

// ✅ Analyze columns (Refactored)
export const analyzeColumns = (data: Record<string, any>[]): ColumnInfo[] => {
  if (data.length === 0) return [];
  
  const columns = Object.keys(data[0]);
  
  return columns.map(columnName => {
    const values = data.map(row => row[columnName]).filter(val => !isMissing(val));
    const missingCount = data.length - values.length;
    const uniqueValues = new Set(values);
    
    // Detect column type
    const numericValues = values.map(toNumber).filter(isFiniteNumber);
    const isNumericCandidate = numericValues.length / values.length > 0.8;
    
    let type: ColumnInfo['type'] = 'text';
    if (isNumericCandidate) {
      type = 'numeric';
    } else if (uniqueValues.size <= 50 || uniqueValues.size / values.length < 0.2) {
      type = 'categorical';
    } else if (values.some(val => !isNaN(Date.parse(val)))) {
      type = 'date';
    }
    
    const columnInfo: ColumnInfo = {
      name: columnName,
      type,
      missingCount,
      uniqueCount: uniqueValues.size
    };
    
    if (type === 'numeric' && numericValues.length > 0) {
      const { min: minVal, max: maxVal } = minMax(numericValues);
      columnInfo.min = minVal;
      columnInfo.max = maxVal;
      columnInfo.mean = mean(numericValues);
      columnInfo.median = median(numericValues);
      columnInfo.std = stdDev(numericValues);
    }
    
    return columnInfo;
  });
};

// ✅ Data summary
export const generateDataSummary = (data: Record<string, any>[]): DataSummary => {
  const totalRows = data.length;
  const totalColumns = data.length > 0 ? Object.keys(data[0]).length : 0;
  
  let missingValues = 0;
  const seen = new Set();
  let duplicates = 0;
  
  data.forEach(row => {
    const rowString = JSON.stringify(row);
    if (seen.has(rowString)) {
      duplicates++;
    } else {
      seen.add(rowString);
    }
    
    Object.values(row).forEach(value => {
      if (isMissing(value)) {
        missingValues++;
      }
    });
  });
  
  const memoryUsage = `${(JSON.stringify(data).length / 1024).toFixed(2)} KB`;
  
  return {
    totalRows,
    totalColumns,
    missingValues,
    duplicates,
    memoryUsage
  };
};

// ✅ AI Insights
export const generateAIInsights = (data: Record<string, any>[], columns: ColumnInfo[]): AIInsight[] => {
  const insights: AIInsight[] = [];
  
  // Missing values
  const highMissingColumns = columns.filter(col => col.missingCount > data.length * 0.2);
  if (highMissingColumns.length > 0) {
    insights.push({
      id: `missing-${Date.now()}`,
      title: 'High Missing Values Detected',
      description: `Columns ${highMissingColumns.map(c => c.name).join(', ')} have more than 20% missing values.`,
      importance: 'high',
      type: 'anomaly',
      confidence: 0.9
    });
  }
  
  // Correlation
  const numericColumns = columns.filter(col => col.type === 'numeric');
  if (numericColumns.length >= 2) {
    insights.push({
      id: `correlation-${Date.now()}`,
      title: 'Potential Correlations Found',
      description: `Found ${numericColumns.length} numeric columns. Explore correlations in visualization.`,
      importance: 'medium',
      type: 'correlation',
      confidence: 0.7
    });
  }
  
  // Categorical distribution
  const categoricalColumns = columns.filter(col => col.type === 'categorical');
  categoricalColumns.forEach(col => {
    if (col.uniqueCount < 10) {
      insights.push({
        id: `category-${col.name}-${Date.now()}`,
        title: `${col.name} Distribution`,
        description: `Column "${col.name}" has ${col.uniqueCount} unique categories.`,
        importance: 'medium',
        type: 'trend',
        confidence: 0.8
      });
    }
  });
  
  // Data quality
  const completeness = (1 - columns.reduce((sum, col) => sum + col.missingCount, 0) / (data.length * columns.length)) * 100;
  if (completeness > 90) {
    insights.push({
      id: `quality-${Date.now()}`,
      title: 'Excellent Data Quality',
      description: `Your dataset has ${completeness.toFixed(1)}% completeness.`,
      importance: 'high',
      type: 'recommendation',
      confidence: 0.95
    });
  }
  
  return insights;
};

// ✅ File validation
export const validateFile = (file: File): { valid: boolean; error?: string } => {
  const maxSize = 10 * 1024 * 1024; // 10MB
  const allowedTypes = [
    'text/csv',
    'application/json',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ];
  
  if (file.size > maxSize) {
    return { valid: false, error: 'File size must be less than 10MB' };
  }
  
  if (!allowedTypes.includes(file.type) && !file.name.endsWith('.csv')) {
    return { valid: false, error: 'Only CSV, Excel, and JSON files are supported' };
  }
  
  return { valid: true };
};
