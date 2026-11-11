import React from 'react';
import ReactDOM from 'react-dom/client';
import { MotionConfig } from 'framer-motion';
import App from './App';
import { WorkspaceRecovery } from './components/workspace/WorkspaceRecovery';
import './index.css';
import './workspace.css';
import './processing/controls.css';
import './motion.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WorkspaceRecovery>
      <MotionConfig reducedMotion="user"><App /></MotionConfig>
    </WorkspaceRecovery>
  </React.StrictMode>
);
