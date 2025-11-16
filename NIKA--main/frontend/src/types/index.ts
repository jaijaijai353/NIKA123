export interface Dataset {
  id: string;
  name: string;
  data: Record<string, any>[];
  columns: ColumnInfo[];
  uploadedAt: Date;
  size: number;
}

export interface ColumnInfo {
  name: string;
  type: 'numeric' | 'categorical' | 'date' | 'text';
  missingCount: number;
  uniqueCount: number;
  min?: number;
  max?: number;
  mean?: number;
  median?: number;
  std?: number;
}

export interface DataSummary {
  totalRows: number;
  totalColumns: number;
  missingValues: number;
  duplicates: number;
  memoryUsage: string;
}

export interface AIInsight {
  id: string;
  title: string;
  description: string;
  importance: 'high' | 'medium' | 'low';
  type: 'anomaly' | 'trend' | 'correlation' | 'recommendation';
  confidence: number;
}