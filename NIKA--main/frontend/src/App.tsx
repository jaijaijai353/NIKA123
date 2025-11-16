import React, { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DataProvider, useDataContext } from './context/DataContext';
import Navigation from './components/Navigation';
import FileUpload from './components/FileUpload';
import Overview from './components/Overview';
import DataCleaning from './components/DataCleaning';
import Analytics from './components/Analytics';
import Visualizations from './components/Visualizations';
import AIInsights from './components/AIInsights';
import Auth from './components/Auth';
import { Toaster } from 'react-hot-toast';
// QnA import removed

const AppContent: React.FC = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const { dataset, isLoading } = useDataContext();

  // Auto-redirect to overview after successful upload
  useEffect(() => {
    if (dataset && activeTab === 'upload') {
      const timer = setTimeout(() => {
        setActiveTab('overview');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [dataset, activeTab]);

  // Show upload screen if no dataset
  if (!dataset && !isLoading) {
    return <FileUpload />;
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview':
        return <Overview />;
      case 'cleaning':
        return <DataCleaning />;
      case 'analytics':
        return <Analytics />;
      case 'visualizations':
        return <Visualizations />;
      case 'insights':
        return <AIInsights />;
      // QnA case removed
      default:
        return <Overview />;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
          className="text-blue-400"
        >
          <div className="h-12 w-12 border-4 border-blue-400 border-t-transparent rounded-full"></div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <Navigation activeTab={activeTab} onTabChange={setActiveTab} />
      
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-4">
          <Auth />
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            {renderTabContent()}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
};

function App() {
  return (
    <DataProvider>
      <AppContent />
      <Toaster position="top-right" />
    </DataProvider>
  );
}

export default App;

