/**
 * Compression History Hook
 * React integration for job history management
 */

import { useState, useCallback, useEffect } from 'react';

/**
 * History entry interface
 */
export interface HistoryEntry {
  id: string;
  name: string;
  createdAt: Date;
  status: 'completed' | 'shared' | 'pending' | 'failed';
  inputFiles: number;
  inputSize: number;
  outputSize: number;
  compressionRatio: number;
  duration: number;
  outputPath?: string;
  shareToken?: string;
  settings: {
    quality: number;
    encrypted: boolean;
    signed: boolean;
  };
}

interface UseHistoryOptions {
  maxEntries?: number;
  autoCleanupDays?: number;
  storageKey?: string;
}

interface UseHistoryReturn {
  entries: HistoryEntry[];
  addEntry: (entry: Omit<HistoryEntry, 'id' | 'createdAt'>) => string;
  updateEntry: (id: string, updates: Partial<HistoryEntry>) => void;
  removeEntry: (id: string) => void;
  getEntry: (id: string) => HistoryEntry | undefined;
  clearHistory: () => void;
  exportHistory: () => string;
  importHistory: (json: string) => void;
}

const STORAGE_KEY = 'spk_compression_history';
const MAX_ENTRIES = 100;
const AUTO_CLEANUP_DAYS = 30;

/**
 * Hook for managing compression history
 */
export function useHistory(options: UseHistoryOptions = {}): UseHistoryReturn {
  const { 
    maxEntries = MAX_ENTRIES, 
    autoCleanupDays = AUTO_CLEANUP_DAYS,
    storageKey = STORAGE_KEY 
  } = options;

  const [entries, setEntries] = useState<HistoryEntry[]>([]);

  /**
   * Load history from localStorage
   */
  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as HistoryEntry[];
        // Convert date strings back to Date objects
        const withDates = parsed.map(entry => ({
          ...entry,
          createdAt: new Date(entry.createdAt)
        }));
        setEntries(withDates);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }, [storageKey]);

  /**
   * Save history to localStorage
   */
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(entries));
    } catch (err) {
      console.error('Failed to save history:', err);
    }
  }, [entries, storageKey]);

  /**
   * Auto-cleanup old entries
   */
  useEffect(() => {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - autoCleanupDays);

    setEntries(prev => 
      prev.filter(entry => entry.createdAt > cutoffDate)
    );
  }, [autoCleanupDays]);

  /**
   * Generate unique ID
   */
  const generateId = (): string => {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  };

  /**
   * Add new entry
   */
  const addEntry = useCallback((
    entry: Omit<HistoryEntry, 'id' | 'createdAt'>
  ): string => {
    const id = generateId();
    const newEntry: HistoryEntry = {
      ...entry,
      id,
      createdAt: new Date(),
    };

    setEntries(prev => {
      const updated = [newEntry, ...prev];
      // Limit entries
      if (updated.length > maxEntries) {
        return updated.slice(0, maxEntries);
      }
      return updated;
    });

    return id;
  }, [maxEntries]);

  /**
   * Update existing entry
   */
  const updateEntry = useCallback((
    id: string,
    updates: Partial<HistoryEntry>
  ) => {
    setEntries(prev =>
      prev.map(entry =>
        entry.id === id ? { ...entry, ...updates } : entry
      )
    );
  }, []);

  /**
   * Remove entry
   */
  const removeEntry = useCallback((id: string) => {
    setEntries(prev => prev.filter(entry => entry.id !== id));
  }, []);

  /**
   * Get entry by ID
   */
  const getEntry = useCallback((id: string): HistoryEntry | undefined => {
    return entries.find(entry => entry.id === id);
  }, [entries]);

  /**
   * Clear all history
   */
  const clearHistory = useCallback(() => {
    setEntries([]);
  }, []);

  /**
   * Export history as JSON
   */
  const exportHistory = useCallback((): string => {
    return JSON.stringify(entries, null, 2);
  }, [entries]);

  /**
   * Import history from JSON
   */
  const importHistory = useCallback((json: string) => {
    try {
      const parsed = JSON.parse(json) as HistoryEntry[];
      const withDates = parsed.map(entry => ({
        ...entry,
        createdAt: new Date(entry.createdAt)
      }));
      setEntries(withDates);
    } catch (err) {
      console.error('Failed to import history:', err);
      throw new Error('Invalid history format');
    }
  }, []);

  return {
    entries,
    addEntry,
    updateEntry,
    removeEntry,
    getEntry,
    clearHistory,
    exportHistory,
    importHistory,
  };
}
