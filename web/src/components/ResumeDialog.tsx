/**
 * SPK Resume Dialog Component
 * 
 * Shows when incomplete jobs are detected on app load.
 * Asks user if they want to resume the previous job.
 * 
 * UI Guidelines:
 * - No version numbers
 * - No emojis
 * - Clean, professional appearance
 * 
 * Creator: Onazi Treasure (OJ)
 */

import { useState, useEffect } from 'react';
import type { ResumeableJob } from '../engine/resume';

export interface ResumeDialogProps {
  jobs: ResumeableJob[];
  onResume: (jobId: string) => void;
  onDiscard: (jobId: string) => void;
  onClose: () => void;
}

export function ResumeDialog({ 
  jobs, 
  onResume, 
  onDiscard, 
  onClose 
}: ResumeDialogProps) {
  const [selectedJob, setSelectedJob] = useState<string | null>(
    jobs.length === 1 ? jobs[0].jobId : null
  );
  
  if (jobs.length === 0) {
    return null;
  }
  
  const formatDate = (date: Date) => {
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };
  
  const formatProgress = (progress: number) => {
    return `${progress.toFixed(1)}%`;
  };
  
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-lg shadow-xl max-w-lg w-full mx-4 border border-zinc-700">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-700">
          <h2 className="text-lg font-semibold text-white">
            Resume Previous Job
          </h2>
          <p className="text-sm text-zinc-400 mt-1">
            An incomplete compression job was found. Would you like to continue?
          </p>
        </div>
        
        {/* Job List */}
        <div className="px-6 py-4 max-h-64 overflow-y-auto">
          {jobs.map((job) => (
            <div
              key={job.jobId}
              className={`
                p-4 rounded-lg mb-2 cursor-pointer transition-colors
                ${selectedJob === job.jobId 
                  ? 'bg-blue-900/30 border border-blue-500' 
                  : 'bg-zinc-800 border border-transparent hover:border-zinc-600'
                }
              `}
              onClick={() => setSelectedJob(job.jobId)}
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-medium text-white">
                    {job.jobName || 'Compression Job'}
                  </h3>
                  <p className="text-sm text-zinc-400 mt-1">
                    {job.filesProcessed} of {job.totalFiles} files
                  </p>
                </div>
                <span className="text-sm text-zinc-400">
                  {formatDate(job.lastUpdated)}
                </span>
              </div>
              
              {/* Progress Bar */}
              <div className="mt-3">
                <div className="flex justify-between text-xs text-zinc-400 mb-1">
                  <span>{formatProgress(job.progress)} complete</span>
                  <span>{job.estimatedTimeRemaining} remaining</span>
                </div>
                <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-500 transition-all"
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
              </div>
              
              <div className="mt-2 text-xs text-zinc-500">
                {job.chunksCompleted.toLocaleString()} of {job.totalChunks.toLocaleString()} chunks
              </div>
            </div>
          ))}
        </div>
        
        {/* Actions */}
        <div className="px-6 py-4 border-t border-zinc-700 flex justify-between">
          <button
            onClick={() => {
              if (selectedJob) {
                onDiscard(selectedJob);
              }
            }}
            disabled={!selectedJob}
            className="px-4 py-2 text-sm text-red-400 hover:text-red-300 disabled:text-zinc-600 disabled:cursor-not-allowed"
          >
            Discard Job
          </button>
          
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
            >
              Start New
            </button>
            <button
              onClick={() => {
                if (selectedJob) {
                  onResume(selectedJob);
                }
              }}
              disabled={!selectedJob}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:bg-zinc-700 disabled:cursor-not-allowed"
            >
              Resume Job
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Resume Progress Indicator
 * 
 * Shows during the resume process: "Restoring progress..."
 */
export interface ResumeProgressProps {
  status: 'detecting' | 'restoring' | 'resuming';
  progress?: number;
}

export function ResumeProgress({ status, progress }: ResumeProgressProps) {
  const messages: Record<string, string> = {
    detecting: 'Checking for incomplete jobs...',
    restoring: 'Restoring progress...',
    resuming: 'Resuming previous job...',
  };
  
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-zinc-900 rounded-lg p-6 flex flex-col items-center">
        {/* Spinner */}
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        
        <p className="text-white font-medium">
          {messages[status]}
        </p>
        
        {progress !== undefined && (
          <div className="mt-3 w-48">
            <div className="h-1 bg-zinc-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Hook for resume dialog state management
 */
export function useResumeDialog() {
  const [jobs, setJobs] = useState<ResumeableJob[]>([]);
  const [showDialog, setShowDialog] = useState(false);
  const [resumeStatus, setResumeStatus] = useState<'idle' | 'detecting' | 'restoring' | 'resuming'>('idle');
  const [resumeProgress, setResumeProgress] = useState<number | undefined>(undefined);
  
  useEffect(() => {
    // Check for incomplete jobs on mount
    const checkJobs = async () => {
      setResumeStatus('detecting');
      
      try {
        // Dynamic import to avoid circular dependencies
        const { checkForIncompleteJobs } = await import('../engine/resume');
        const incompleteJobs = await checkForIncompleteJobs();
        
        if (incompleteJobs.length > 0) {
          setJobs(incompleteJobs);
          setShowDialog(true);
        }
      } catch (error) {
        console.error('Failed to check for incomplete jobs:', error);
      } finally {
        setResumeStatus('idle');
      }
    };
    
    checkJobs();
  }, []);
  
  const handleResume = async (jobId: string) => {
    setShowDialog(false);
    setResumeStatus('restoring');
    setResumeProgress(0);
    
    try {
      const { getAutoResumeManager } = await import('../engine/resume');
      const manager = getAutoResumeManager();
      
      setResumeProgress(30);
      setResumeStatus('resuming');
      
      const result = await manager.resume(jobId);
      
      setResumeProgress(100);
      
      if (!result.success) {
        console.error('Resume failed:', result.error);
        // Could show error toast here
      }
      
    } catch (error) {
      console.error('Resume error:', error);
    } finally {
      setResumeStatus('idle');
      setResumeProgress(undefined);
    }
  };
  
  const handleDiscard = async (jobId: string) => {
    try {
      const { getAutoResumeManager } = await import('../engine/resume');
      const manager = getAutoResumeManager();
      await manager.cancelResume(jobId);
      
      setJobs(jobs.filter(j => j.jobId !== jobId));
      
      if (jobs.length <= 1) {
        setShowDialog(false);
      }
    } catch (error) {
      console.error('Discard error:', error);
    }
  };
  
  const handleClose = () => {
    setShowDialog(false);
  };
  
  return {
    jobs,
    showDialog,
    resumeStatus,
    resumeProgress,
    handleResume,
    handleDiscard,
    handleClose,
  };
}
