/**
 * SPK V26 - Storage Dashboard
 * Account overview with storage stats and HAMMA preferences
 */

import { useMemo } from 'react';
import { useAccountStore, formatBytes, StorageTier } from '../../store/account';

// Tier badges
const tierConfig: Record<StorageTier, { label: string; color: string; icon: string }> = {
  free: { label: 'Free', color: 'bg-slate-500', icon: 'F' },
  basic: { label: 'Basic', color: 'bg-blue-500', icon: 'B' },
  pro: { label: 'Pro', color: 'bg-purple-500', icon: 'P' },
  enterprise: { label: 'Enterprise', color: 'bg-amber-500', icon: 'E' },
};

export function StorageDashboard() {
  const { account, stats, hammaPrefs, setHammaPrefs, logout } = useAccountStore();
  
  const storagePercent = useMemo(() => {
    if (!account) return 0;
    return Math.min((account.storageUsed / account.storageQuota) * 100, 100);
  }, [account]);
  
  const storageColor = useMemo(() => {
    if (storagePercent > 90) return 'from-red-500 to-red-600';
    if (storagePercent > 70) return 'from-yellow-500 to-orange-500';
    return 'from-emerald-500 to-cyan-500';
  }, [storagePercent]);
  
  if (!account) {
    return (
      <div className="flex items-center justify-center h-full text-slate-400">
        <p>Please log in to view your dashboard</p>
      </div>
    );
  }
  
  const tier = tierConfig[account.tier];
  
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            Welcome, {account.displayName}
            <span className={`text-sm px-3 py-1 rounded-full ${tier.color} text-white`}>
              {tier.icon} {tier.label}
            </span>
          </h1>
          <p className="text-slate-400 mt-1">Account ID: {account.accountId}</p>
        </div>
        <button
          onClick={logout}
          className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
        >
          Logout
        </button>
      </div>
      
      {/* Storage Overview */}
      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          Storage
        </h2>
        
        {/* Storage Bar */}
        <div className="relative h-8 bg-slate-700 rounded-full overflow-hidden">
          <div 
            className={`absolute inset-y-0 left-0 bg-gradient-to-r ${storageColor} transition-all duration-500`}
            style={{ width: `${storagePercent}%` } as React.CSSProperties}
          />
          <div className="absolute inset-0 flex items-center justify-center text-white font-medium">
            {formatBytes(account.storageUsed)} / {formatBytes(account.storageQuota)}
          </div>
        </div>
        
        <div className="flex justify-between mt-2 text-sm">
          <span className="text-slate-400">{storagePercent.toFixed(1)}% used</span>
          <span className="text-emerald-400">{formatBytes(account.storageQuota - account.storageUsed)} available</span>
        </div>
        
        {/* Upgrade CTA for free tier */}
        {account.tier === 'free' && (
          <div className="mt-4 p-4 rounded-xl bg-gradient-to-r from-purple-500/20 to-pink-500/20 border border-purple-500/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-white">Upgrade to Pro</p>
                <p className="text-sm text-slate-300">Plan upgrades are not available yet.</p>
              </div>
              <button disabled title="Plan upgrades are not available yet" className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold opacity-50 cursor-not-allowed">
                Upgrade
              </button>
            </div>
          </div>
        )}
      </div>
      
      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon="Files"
          label="Total Files"
          value={account.fileCount.toString()}
        />
        <StatCard
          icon="Archives"
          label="Archives"
          value={account.archiveCount.toString()}
        />
        <StatCard
          icon="Saved"
          label="Space Saved"
          value={formatBytes(stats.savings)}
          color="text-emerald-400"
        />
        <StatCard
          icon="Speed"
          label="Compression"
          value={`${stats.compressionRatio.toFixed(1)}x`}
          color="text-cyan-400"
        />
      </div>
      
      {/* File Type Breakdown */}
      {Object.keys(stats.byType).length > 0 && (
        <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            Files by Type
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(stats.byType).map(([type, count]) => (
              <div key={type} className="p-3 rounded-lg bg-slate-900">
                <div className="text-2xl mb-1">
                  {type === 'document' && 'Doc'}
                  {type === 'image' && 'Img'}
                  {type === 'video' && 'Vid'}
                  {type === 'audio' && 'Aud'}
                  {type === 'archive' && 'Arc'}
                  {type === 'code' && 'Code'}
                  {type === 'data' && 'Data'}
                  {type === 'binary' && '⚙️'}
                  {type === 'unknown' && '❓'}
                </div>
                <p className="font-medium text-white">{String(count)}</p>
                <p className="text-xs text-slate-400 capitalize">{type}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* HAMMA Preferences */}
      <fieldset disabled className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          HAMMA Preferences
        </h2>
        <p className="text-sm text-slate-400 mb-4">These preferences are not connected to compression yet.</p>
        
        <div className="space-y-6">
          {/* Speed Mode */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Speed Mode
            </label>
            <div className="grid grid-cols-4 gap-2">
              {(['fast', 'balanced', 'max', 'auto'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setHammaPrefs({ speedMode: mode })}
                  className={`px-4 py-3 rounded-lg border transition-all ${
                    hammaPrefs.speedMode === mode
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="text-lg mb-1">
                    {mode === 'fast' && 'Fast'}
                    {mode === 'balanced' && 'Bal'}
                    {mode === 'max' && 'Max'}
                    {mode === 'auto' && 'Auto'}
                  </div>
                  <span className="text-sm capitalize">{mode}</span>
                </button>
              ))}
            </div>
          </div>
          
          {/* Codec */}
          <div>
            <label htmlFor="codec-select" className="block text-sm font-medium text-slate-300 mb-2">
              Compression Codec
            </label>
            <select
              id="codec-select"
              value={hammaPrefs.codec}
              onChange={(e) => setHammaPrefs({ codec: e.target.value as 'zstd' | 'lz4' | 'brotli' })}
              aria-label="Compression codec"
              className="w-full px-4 py-3 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="zstd">Zstandard (Best Balance)</option>
              <option value="lz4">LZ4 (Fastest)</option>
              <option value="brotli">Brotli (Best Ratio)</option>
            </select>
          </div>
          
          {/* Toggles */}
          <div className="grid grid-cols-2 gap-4">
            <ToggleSetting
              label="Deduplication"
              description="Detect duplicate content"
              icon="Dedup"
              checked={hammaPrefs.enableDedup}
              onChange={(v) => setHammaPrefs({ enableDedup: v })}
            />
            <ToggleSetting
              label="Delta Compression"
              description="Track file changes"
              icon="Delta"
              checked={hammaPrefs.enableDelta}
              onChange={(v) => setHammaPrefs({ enableDelta: v })}
            />
            <ToggleSetting
              label="Dictionary"
              description="Use shared dictionaries"
              icon="Dict"
              checked={hammaPrefs.enableDictionary}
              onChange={(v) => setHammaPrefs({ enableDictionary: v })}
            />
            <ToggleSetting
              label="Auto Organize"
              description="Sort files by type"
              icon="Auto"
              checked={hammaPrefs.autoOrganize}
              onChange={(v) => setHammaPrefs({ autoOrganize: v })}
            />
          </div>
        </div>
      </fieldset>
      
      {/* Account Info */}
      <div className="bg-slate-800 rounded-2xl p-6 border border-slate-700">
        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          Account Settings
        </h2>
        <p className="text-sm text-slate-400 mb-4">Password changes, recovery phrase viewing, and account deletion are not available yet.</p>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg bg-slate-900">
            <div>
              <p className="font-medium text-white">Change Password</p>
              <p className="text-sm text-slate-400">Update your account password</p>
            </div>
            <button disabled className="px-4 py-2 rounded-lg bg-slate-700 text-white opacity-50 cursor-not-allowed">
              Change
            </button>
          </div>
          
          <div className="flex items-center justify-between p-4 rounded-lg bg-slate-900">
            <div>
              <p className="font-medium text-white">View Recovery Phrase</p>
              <p className="text-sm text-slate-400">Requires password confirmation</p>
            </div>
            <button disabled className="px-4 py-2 rounded-lg bg-slate-700 text-white opacity-50 cursor-not-allowed">
              View
            </button>
          </div>
          
          <div className="flex items-center justify-between p-4 rounded-lg bg-red-500/10 border border-red-500/30">
            <div>
              <p className="font-medium text-red-400">Delete Account</p>
              <p className="text-sm text-slate-400">Permanently delete your account and all data</p>
            </div>
            <button disabled className="px-4 py-2 rounded-lg bg-red-500/20 text-red-400 opacity-50 cursor-not-allowed">
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Stat Card Component
function StatCard({ 
  icon, 
  label, 
  value, 
  color = 'text-white' 
}: { 
  icon: string; 
  label: string; 
  value: string; 
  color?: string;
}) {
  return (
    <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
      <div className="text-2xl mb-2">{icon}</div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-sm text-slate-400">{label}</p>
    </div>
  );
}

// Toggle Setting Component
function ToggleSetting({
  label,
  description,
  icon,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  icon: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button type="button" aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={`p-4 rounded-lg border cursor-pointer transition-all ${
        checked
          ? 'bg-emerald-500/10 border-emerald-500/30'
          : 'bg-slate-900 border-slate-700 hover:border-slate-600'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-lg">{icon}</span>
        <div className={`w-10 h-6 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-slate-600'}`}>
          <div className={`w-5 h-5 rounded-full bg-white mt-0.5 transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
        </div>
      </div>
      <p className="font-medium text-white">{label}</p>
      <p className="text-xs text-slate-400">{description}</p>
    </button>
  );
}
