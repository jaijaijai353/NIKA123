import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { Dataset, DataSummary, AIInsight, ColumnInfo } from "../types";
import { generateAIInsights, analyzeColumns } from "../utils/dataProcessor";

// 🔹 API base URL from env
const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

interface DataContextType {
  rawDataset: Dataset | null;
  dataset: Dataset | null;
  dataSummary: DataSummary | null;
  aiInsights: AIInsight[];
  isLoading: boolean;
  setDataset: (dataset: Dataset | null) => void;
  setRawDataset: (dataset: Dataset | null) => void;
  setDataSummary: (summary: DataSummary | null) => void;
  setAIInsights: (insights: AIInsight[]) => void;
  setIsLoading: (loading: boolean) => void;
  updateCleanedData: (cleanedData: any[], summary?: DataSummary) => void;
  forceDatasetUpdate: (newData: any[]) => void;
  updateCounter: number;
  fetchDatasets: () => Promise<Dataset[]>;
  fetchPreview: (datasetId: string, limit?: number) => Promise<any | null>;
  fetchSummary: (datasetId: string) => Promise<DataSummary | null>;
  uploadDataset: (file: File) => Promise<Dataset | null>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const useDataContext = () => {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error("useDataContext must be used within a DataProvider");
  }
  return context;
};

interface DataProviderProps {
  children: ReactNode;
}

export const DataProvider: React.FC<DataProviderProps> = ({ children }) => {
  const [rawDataset, setRawDataset] = useState<Dataset | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [dataSummary, setDataSummary] = useState<DataSummary | null>(null);
  const [aiInsights, setAIInsights] = useState<AIInsight[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialUpload, setIsInitialUpload] = useState(true);
  const [updateCounter, setUpdateCounter] = useState(0);

  // 🔹 Update cleaned data
  const updateCleanedData = (cleanedData: any[], summary?: DataSummary) => {
    if (!dataset || isInitialUpload) return;
    const updatedDataset = { ...dataset, data: [...cleanedData], updatedAt: new Date() };
    setDataset(updatedDataset);
    setUpdateCounter(prev => prev + 1);
    if (summary) setDataSummary(summary);
  };

  // 🔹 Force dataset update
  const forceDatasetUpdate = (newData: any[]) => {
    if (!dataset) return;
    const forcedDataset = { ...dataset, data: [...newData], updatedAt: new Date(), forced: true };
    setDataset(forcedDataset);
    setUpdateCounter(prev => prev + 1);
  };

  // 🔹 Wrapper for setDataset
  const handleSetDataset = (newDataset: Dataset | null) => {
    if (newDataset && isInitialUpload) setIsInitialUpload(false);
    setDataset(newDataset);
  };

  // 🔹 Fetch AI insights whenever dataset changes
  useEffect(() => {
    const fetchInsights = async () => {
      if (!dataset) {
        setAIInsights([]);
        return;
      }
      setIsLoading(true);
      try {
        const columns: ColumnInfo[] = analyzeColumns(dataset.data);
        const insights = await generateAIInsights(dataset.data, columns);
        setAIInsights(insights);
      } catch (error) {
        console.error("Error generating AI insights:", error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchInsights();
  }, [dataset]);

  // 🔹 API calls

  const fetchDatasets = async (): Promise<Dataset[]> => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/datasets`);
      if (!res.ok) throw new Error("Failed to fetch datasets");
      return await res.json();
    } catch (error) {
      console.error(error);
      return [];
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPreview = async (datasetId: string, limit = 5): Promise<any | null> => {
    try {
      const res = await fetch(`${API_BASE}/preview/${datasetId}?limit=${limit}`);
      if (!res.ok) throw new Error("Failed to fetch preview");
      return await res.json();
    } catch (error) {
      console.error(error);
      return null;
    }
  };

  const fetchSummary = async (datasetId: string): Promise<DataSummary | null> => {
    try {
      const res = await fetch(`${API_BASE}/summary/${datasetId}`);
      if (!res.ok) throw new Error("Failed to fetch summary");
      return await res.json();
    } catch (error) {
      console.error(error);
      return null;
    }
  };

  const uploadDataset = async (file: File): Promise<Dataset | null> => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      const uploaded = await res.json();
      setDataset(uploaded);
      setRawDataset(uploaded);
      return uploaded;
    } catch (error) {
      console.error(error);
      return null;
    }
  };

  return (
    <DataContext.Provider
      value={{
        rawDataset,
        dataset,
        dataSummary,
        aiInsights,
        isLoading,
        setDataset: handleSetDataset,
        setRawDataset,
        setDataSummary,
        setAIInsights,
        setIsLoading,
        updateCleanedData,
        forceDatasetUpdate,
        updateCounter,
        fetchDatasets,
        fetchPreview,
        fetchSummary,
        uploadDataset,
      }}
    >
      {children}
    </DataContext.Provider>
  );
};
