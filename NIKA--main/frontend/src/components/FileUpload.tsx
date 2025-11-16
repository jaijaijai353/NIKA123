import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, CheckCircle, AlertCircle, FileText, RefreshCw } from 'lucide-react';
import { useDataContext } from '../context/DataContext';
import {
  parseCSV,
  analyzeColumns,
  generateDataSummary,
  generateAIInsights,
} from '../utils/dataProcessor';
import * as XLSX from 'xlsx';
import { auth, storage, db, isFirebaseConfigured } from '../firebase/clientApp';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { User as FirebaseUser } from 'firebase/auth';
import toast from 'react-hot-toast';

// --- CONSTANTS ---
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_EXTENSIONS = ['csv', 'json', 'xlsx', 'xls'];
const PREVIEW_ROW_COUNT = 5;

// --- TYPE DEFINITIONS ---

/** Represents the possible states of the file upload process. */
type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

/** Describes the details of the file being uploaded. */
interface FileDetails {
  name: string;
  size: number;
}

/** Defines the complete state managed by the useFileUpload hook. */
interface UseFileUploadState {
  uploadStatus: UploadStatus;
  errorMessage: string;
  datasetPreview: any[];
  fileDetails: FileDetails | null;
  progress: number;
}

// --- UTILITY FUNCTIONS ---

/**
 * Formats file size in bytes to a human-readable string (KB, MB).
 * @param bytes - The file size in bytes.
 * @returns A formatted string representing the file size.
 */
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Truncates a string if it exceeds a specified length, adding an ellipsis.
 * @param str - The string to truncate.
 * @param num - The maximum length of the string before truncation.
 * @returns The potentially truncated string.
 */
const truncateString = (str: string, num: number): string => {
  if (str.length <= num) {
    return str;
  }
  return str.slice(0, num) + '...';
};

/**
 * Extracts the file extension from a filename.
 * @param filename - The full name of the file.
 * @returns The file's extension in lowercase, or undefined if not found.
 */
const getFileExtension = (filename: string): string | undefined => {
  return filename.split('.').pop()?.toLowerCase();
};


// --- CUSTOM HOOK for File Upload Logic ---

/**
 * A comprehensive hook to manage the entire file upload and processing lifecycle.
 * It encapsulates state, validation, parsing, analysis, and state transitions.
 * @returns An object containing the current upload state and handler functions.
 */
const useFileUpload = () => {
  const {
    setDataset,
    setDataSummary,
    setAIInsights,
    setIsLoading: setAppIsLoading,
    setRawDataset,
  } = useDataContext();

  const [state, setState] = useState<UseFileUploadState>({
    uploadStatus: 'idle',
    errorMessage: '',
    datasetPreview: [],
    fileDetails: null,
    progress: 0,
  });

  const [currentUser, setCurrentUser] = useState<FirebaseUser | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Monitor auth state
  useEffect(() => {
    if (!auth || !isFirebaseConfigured) return;
    
    const unsubscribe = auth.onAuthStateChanged((user) => {
      setCurrentUser(user);
    });

    return () => unsubscribe();
  }, []);

  // Cleanup interval on component unmount
  useEffect(() => {
    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    };
  }, []);

  /** Resets the uploader to its initial 'idle' state. */
  const resetState = useCallback(() => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    setState({
      uploadStatus: 'idle',
      errorMessage: '',
      datasetPreview: [],
      fileDetails: null,
      progress: 0,
    });
    setAppIsLoading(false);
  }, [setAppIsLoading]);

  /** Simulates a progress bar for better user feedback during processing. */
  const startProgressSimulation = () => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    setState(s => ({ ...s, progress: 0 }));
    progressIntervalRef.current = setInterval(() => {
      setState(s => {
        const newProgress = s.progress + Math.random() * 10;
        if (newProgress >= 95) {
          if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
          return { ...s, progress: 95 };
        }
        return { ...s, progress: newProgress };
      });
    }, 200);
  };
  
  /** Completes the progress bar animation. */
  const finishProgress = () => {
     if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
     setState(s => ({...s, progress: 100}));
  }

  /** The core function to handle file selection, validation, and processing. */
  const handleFile = useCallback(async (file: File | null) => {
    if (!file) return;

    // --- File Validation ---
    if (file.size > MAX_FILE_SIZE) {
      setState(s => ({ ...s, uploadStatus: 'error', errorMessage: `File is too large. Max size is ${formatFileSize(MAX_FILE_SIZE)}.` }));
      return;
    }
    const fileExtension = getFileExtension(file.name);
    if (!fileExtension || !ALLOWED_EXTENSIONS.includes(fileExtension)) {
      setState(s => ({ ...s, uploadStatus: 'error', errorMessage: 'Unsupported file format.' }));
      return;
    }

    setAppIsLoading(true);
    setState(s => ({
      ...s,
      uploadStatus: 'uploading',
      errorMessage: '',
      fileDetails: { name: file.name, size: file.size },
    }));
    startProgressSimulation();

    try {
      const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000';
      let storagePath: string | null = null;
      let uploadId: string | null = null;

      // --- Firebase Upload Path (if user is logged in) ---
      if (currentUser && isFirebaseConfigured && storage && db) {
        try {
          // Upload to Firebase Storage
          const timestamp = Date.now();
          const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
          storagePath = `uploads/${currentUser.uid}/${timestamp}_${sanitizedName}`;
          const storageRef = ref(storage, storagePath);
          
          setState(s => ({ ...s, progress: 20 }));
          await uploadBytes(storageRef, file);
          setState(s => ({ ...s, progress: 50 }));

          // Save upload metadata to Firestore
          const uploadDoc = await addDoc(collection(db, 'uploads'), {
            uid: currentUser.uid,
            filename: file.name,
            mimeType: file.type,
            size: file.size,
            storagePath,
            createdAt: serverTimestamp(),
          });
          uploadId = uploadDoc.id;
          setState(s => ({ ...s, progress: 70 }));

          toast.success('File uploaded to Firebase Storage');

          // Call backend /api/insights with storagePath and uploadId
          const insightsResponse = await fetch(`${API_BASE}/api/insights`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${await currentUser.getIdToken()}`,
            },
            body: JSON.stringify({ storagePath, uploadId }),
          });

          if (!insightsResponse.ok) {
            throw new Error('Failed to generate insights from backend');
          }

          const insightsData = await insightsResponse.json();
          setState(s => ({ ...s, progress: 90 }));

          // Update context with insights data
          if (insightsData.data && Array.isArray(insightsData.data)) {
            const columns = analyzeColumns(insightsData.data);
            const summary = generateDataSummary(insightsData.data);
            const insights = generateAIInsights(insightsData.data, columns);
            
            const dataset = {
              id: insightsData.id || `dataset-${Date.now()}`,
              name: file.name,
              data: insightsData.data,
              columns,
              uploadedAt: new Date(insightsData.uploadedAt || Date.now()),
              size: file.size,
            };
            const rawDataset = {
              id: `raw-${Date.now()}`,
              name: file.name,
              data: insightsData.data,
              uploadedAt: new Date(),
              size: file.size,
            };

            setRawDataset(rawDataset);
            setDataset(dataset);
            setDataSummary(summary);
            setAIInsights(insights);

            finishProgress();
            setState(s => ({
              ...s,
              uploadStatus: 'success',
              datasetPreview: insightsData.data.slice(0, PREVIEW_ROW_COUNT),
            }));
          } else {
            throw new Error('Invalid insights data from backend');
          }

          return;
        } catch (firebaseError) {
          console.error('Firebase upload failed, falling back to local:', firebaseError);
          toast.error('Firebase upload failed, using local processing');
          // Fall through to local processing
        }
      }

      // --- Local Processing (fallback or when not logged in) ---
      let data: Record<string, any>[] = [];

      switch (fileExtension) {
        case 'csv':
          data = await parseCSV(file);
          break;
        case 'json':
          const text = await file.text();
          data = JSON.parse(text);
          if (!Array.isArray(data)) throw new Error('JSON must be an array of objects.');
          break;
        case 'xlsx':
        case 'xls':
          const arrayBuffer = await file.arrayBuffer();
          const workbook = XLSX.read(arrayBuffer, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          data = XLSX.utils.sheet_to_json(worksheet);
          break;
        default:
          throw new Error('This should not happen due to prior validation.');
      }

      if (!data || data.length === 0) throw new Error('No data found in file.');

      // --- Data Normalization Logic (nested for encapsulation) ---
      const excelSerialToDate = (serial: number): Date => new Date(Date.UTC(1899, 11, 30) + serial * 24 * 60 * 60 * 1000);
      const isLikelyExcelSerial = (val: number): boolean => Number.isInteger(val) && val >= 20000 && val <= 80000;
      const normalizeDates = (rows: Record<string, any>[]): Record<string, any>[] => {
        if (!rows.length) return rows;
        const keys = Object.keys(rows[0] || {});
        const dateHeaderHint = keys.reduce((acc, k) => ({ ...acc, [k]: /(date|time)/i.test(k) }), {});
        return rows.map(row => {
          const newRow = { ...row };
          for (const k of keys) {
            const v = newRow[k];
            if (typeof v === 'number' && dateHeaderHint[k] && isLikelyExcelSerial(v)) {
              newRow[k] = excelSerialToDate(v).toLocaleDateString('en-GB');
            } else if (typeof v === 'string' && v.length > 5 && /[/\-\s]/.test(v)) {
              const parsed = new Date(v);
              if (!isNaN(parsed.getTime())) newRow[k] = parsed.toLocaleDateString('en-GB');
            }
          }
          return newRow;
        });
      };
      
      const normalizedData = normalizeDates([...data]);

      // --- Data Analysis & Context Update ---
      const columns = analyzeColumns(normalizedData);
      const summary = generateDataSummary(normalizedData);
      const insights = generateAIInsights(normalizedData, columns);
      
      const dataset = { id: `dataset-${Date.now()}`, name: file.name, data: normalizedData, columns, uploadedAt: new Date(), size: file.size };
      const rawDataset = { id: `raw-${Date.now()}`, name: file.name, data, uploadedAt: new Date(), size: file.size };
      
      setRawDataset(rawDataset);
      setDataset(dataset);
      setDataSummary(summary);
      setAIInsights(insights);

      // --- Finalize State ---
      finishProgress();
      setState(s => ({
        ...s,
        uploadStatus: 'success',
        datasetPreview: normalizedData.slice(0, PREVIEW_ROW_COUNT),
      }));

    } catch (error) {
      console.error("File processing failed:", error);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      setState(s => ({
        ...s,
        uploadStatus: 'error',
        errorMessage: error instanceof Error ? error.message : 'An unknown error occurred.',
        progress: 0,
      }));
      toast.error(error instanceof Error ? error.message : 'File processing failed');
    } finally {
      setAppIsLoading(false);
    }
  }, [setAppIsLoading, setRawDataset, setDataset, setDataSummary, setAIInsights, currentUser]);

  return { ...state, handleFile, resetState };
};


// --- UI SUB-COMPONENTS ---

/**
 * Renders the main animated header for the page.
 */
const WelcomeHeader: React.FC = () => {
  const title = "Welcome to NIKA";
  const subtitle = "Upload your dataset to unlock advanced analytics";

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: { staggerChildren: 0.08, delayChildren: 0.2 },
    },
  };

  const wordVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { type: 'spring', damping: 12, stiffness: 100 } },
  };

  return (
    <div className="text-center mb-10">
      <motion.h1
        className="text-5xl md:text-6xl font-extrabold text-white mb-4 bg-clip-text text-transparent bg-gradient-to-r from-gray-400 to-gray-200"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {title.split(" ").map((word, index) => (
          <motion.span key={index} variants={wordVariants} className="inline-block mr-[0.25em]">
            {word}
          </motion.span>
        ))}
      </motion.h1>
      <motion.p
        className="text-gray-400 text-lg"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.8 }}
      >
        {subtitle}
      </motion.p>
    </div>
  );
};

/**
 * Displays a preview of the uploaded data in a formatted table.
 * @param {object} props - The component props.
 * @param {any[]} props.data - The array of data rows to display.
 */
const DataPreview: React.FC<{ data: any[] }> = ({ data }) => {
    if (!data.length) return null;
    const headers = Object.keys(data[0]);

    return (
        <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="mt-6 w-full text-left bg-zinc-950/70 p-4 rounded-lg max-h-60 overflow-auto border border-gray-700"
        >
            <h3 className="text-white font-semibold mb-3 text-sm">Data Preview:</h3>
            <table className="w-full text-xs text-gray-300 border-collapse table-auto">
                <thead>
                    <tr className="bg-white/5">
                        {headers.map(col => (
                            <th key={col} className="sticky top-0 bg-zinc-900/80 backdrop-blur-sm border-b border-gray-700 px-3 py-2 text-left font-medium text-gray-400 uppercase tracking-wider">
                                {truncateString(col, 20)}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {data.map((row, idx) => (
                        <tr key={idx} className="hover:bg-white/10 transition-colors duration-200">
                            {headers.map(col => (
                                <td key={col} className="border-b border-gray-800 px-3 py-2 whitespace-nowrap">
                                    {String(row[col])}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </motion.div>
    );
};

/**
 * Renders the specific UI for each upload state (idle, uploading, success, error).
 * @param {UseFileUploadState & { onReset: () => void }} props - The current state and reset handler.
 */
const FileStateUI: React.FC<UseFileUploadState & { onReset: () => void }> = ({ uploadStatus, errorMessage, datasetPreview, fileDetails, progress, onReset }) => {
    const statusMap = {
        idle: { icon: FileText, color: 'text-gray-500', title: 'Click to upload', subtitle: 'or drag and drop' },
        uploading: { icon: Upload, color: 'text-blue-400', title: 'Processing...', subtitle: fileDetails ? truncateString(fileDetails.name, 30) : '' },
        success: { icon: CheckCircle, color: 'text-green-400', title: 'Analysis Complete!', subtitle: `${formatFileSize(fileDetails?.size ?? 0)} uploaded.` },
        error: { icon: AlertCircle, color: 'text-red-400', title: 'Upload Failed', subtitle: errorMessage },
    };

    const currentStatus = statusMap[uploadStatus];
    const IconComponent = currentStatus.icon;

    return (
        <AnimatePresence mode="wait">
            <motion.div
                key={uploadStatus}
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -10 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col items-center justify-center w-full"
            >
                <IconComponent className={`h-16 w-16 mb-4 ${currentStatus.color}`} />
                <p className={`text-lg font-medium text-white mb-1`}>{currentStatus.title}</p>
                <p className="text-sm text-gray-400 min-h-[20px]">{currentStatus.subtitle}</p>
                
                {uploadStatus === 'uploading' && (
                    <div className="w-full bg-gray-700 rounded-full h-1.5 mt-4">
                        <motion.div
                            className="bg-blue-400 h-1.5 rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.5, ease: 'linear' }}
                        />
                    </div>
                )}

                {uploadStatus === 'success' && <DataPreview data={datasetPreview} />}
                {(uploadStatus === 'success' || uploadStatus === 'error') && (
                    <motion.button
                        onClick={onReset}
                        className="mt-6 flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-gray-800/50 rounded-md hover:bg-gray-700/50 border border-gray-700 transition-all"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        <RefreshCw className="h-4 w-4" />
                        Upload Another File
                    </motion.button>
                )}
            </motion.div>
        </AnimatePresence>
    );
};

/**
 * The main drag-and-drop card component.
 * @param {object} props - Component props.
 * @param {(file: File | null) => void} props.onFileSelect - Callback for when a file is selected.
 * @param {UseFileUploadState} props.uploadState - The current state from the useFileUpload hook.
 * @param {() => void} props.onReset - Callback to reset the uploader.
 */
const FileUploadCard: React.FC<{
  onFileSelect: (file: File | null) => void;
  uploadState: UseFileUploadState;
  onReset: () => void;
}> = ({ onFileSelect, uploadState, onReset }) => {
    const [dragActive, setDragActive] = useState(false);
    
    const handleDrag = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
        else if (e.type === 'dragleave') setDragActive(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            onFileSelect(e.dataTransfer.files[0]);
        }
    }, [onFileSelect]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onFileSelect(e.target.files[0]);
            e.target.value = ''; // Reset file input to allow re-uploading the same file
        }
    };
    
    const borderColor = useMemo(() => {
        if (dragActive) return 'border-blue-400';
        if (uploadState.uploadStatus === 'success') return 'border-green-400';
        if (uploadState.uploadStatus === 'error') return 'border-red-400';
        return 'border-gray-600';
    }, [dragActive, uploadState.uploadStatus]);
    
    const glowEffect = useMemo(() => {
        if (dragActive) return 'shadow-[0_0_20px_theme(colors.blue.500/0.5)]';
        if (uploadState.uploadStatus === 'success') return 'shadow-[0_0_20px_theme(colors.green.500/0.5)]';
        if (uploadState.uploadStatus === 'error') return 'shadow-[0_0_20px_theme(colors.red.500/0.5)]';
        return 'shadow-none';
    }, [dragActive, uploadState.uploadStatus]);

    return (
        <motion.div
            className={`relative border-2 border-dashed rounded-xl p-8 sm:p-12 text-center transition-all duration-300 backdrop-blur-md bg-zinc-900/60 min-h-[350px] flex items-center justify-center
            ${borderColor} ${glowEffect}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            whileHover={uploadState.uploadStatus === 'idle' ? { scale: 1.02, borderColor: '#9ca3af' } : {}}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        >
            <input
                type="file"
                id="file-upload"
                aria-label="File uploader"
                accept={ALLOWED_EXTENSIONS.map(ext => `.${ext}`).join(',')}
                onChange={handleChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                disabled={uploadState.uploadStatus === 'uploading'}
            />
            <FileStateUI {...uploadState} onReset={onReset} />
        </motion.div>
    );
};


// --- MAIN PAGE COMPONENT ---

/**
 * The primary FileUpload page component that assembles all sub-components and logic.
 */
const FileUpload: React.FC = () => {
    const uploadState = useFileUpload();

    return (
        <div className="relative min-h-screen bg-black flex items-center justify-center p-4 overflow-hidden">
            <motion.div
                className="w-full max-w-3xl relative z-10"
                initial="hidden"
                animate="visible"
                variants={{
                    hidden: { opacity: 0 },
                    visible: { opacity: 1, transition: { duration: 0.5 } },
                }}
            >
                <WelcomeHeader />
                <FileUploadCard 
                  onFileSelect={uploadState.handleFile} 
                  uploadState={uploadState} 
                  onReset={uploadState.resetState} 
                />
            </motion.div>
        </div>
    );
};

export default FileUpload;
