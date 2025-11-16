import React from 'react';
import { motion } from 'framer-motion';
import { 
  Home, 
  RectangleVertical as CleaningServices, 
  FlipVertical as Analytics, 
  BarChart3, 
  Brain, 
  Database
} from 'lucide-react';

interface NavigationProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

const Navigation: React.FC<NavigationProps> = ({ activeTab, onTabChange }) => {
  const tabs = [
    { id: 'overview', label: 'Overview', icon: Home },
    { id: 'cleaning', label: 'Data Cleaning', icon: CleaningServices },
    { id: 'analytics', label: 'Analytics', icon: Analytics },
    { id: 'visualizations', label: 'Visualizations', icon: BarChart3 },
    { id: 'insights', label: 'AI Insights', icon: Brain },
    // Q&A tab removed
  ];

  return (
    <nav className="bg-black/90 backdrop-blur-lg border-b border-gray-800 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Left side branding */}
          <div className="flex items-center space-x-3">
            <Database className="h-8 w-8 text-blue-500" />
            <h1 className="text-xl font-bold text-white">NIKA</h1>
            <span className="text-xs text-gray-400 font-medium">by Jai Narula</span>
          </div>

          {/* Right side navigation */}
          <div className="flex space-x-1">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <motion.button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={`relative px-4 py-2 rounded-lg flex items-center space-x-2 transition-all duration-200 ${
                    activeTab === tab.id
                      ? 'text-white bg-gray-800'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                  }`}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Icon className="h-4 w-4" />
                  <span className="text-sm font-medium hidden sm:block">{tab.label}</span>
                  {activeTab === tab.id && (
                    <motion.div
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500"
                      layoutId="activeTab"
                    />
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;


