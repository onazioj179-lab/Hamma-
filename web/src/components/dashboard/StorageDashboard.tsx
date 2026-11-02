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
  const { account, stats, logout } = useAccountStore();

  const storagePercent = useMemo(() => {
    if (!account) return 0;
    return account.storageQuota > 0 ? Math.min((account.storageUsed / account.storageQuota) * 100, 100) : 0;
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
    <div className="workspace-surface max-w-4xl mx-auto p-6 space-y-6">
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
                  {type === 'binary' && 'Bin'}
                  {type === 'unknown' && 'Other'}
                </div>
                <p className="font-medium text-white">{String(count)}</p>
                <p className="text-xs text-slate-400 capitalize">{type}</p>
              </div>
            ))}
          </div>
        </div>
      )}


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
      <div className="text-xs text-slate-400 mb-2">{icon}</div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-sm text-slate-400">{label}</p>
    </div>
  );
}
