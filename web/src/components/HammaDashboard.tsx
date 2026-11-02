import { API_BASE } from "../config";
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/Card';
import { Badge } from './ui/badge';
import { Button } from './ui/Button';
import { Alert, AlertDescription } from './ui/alert';
import { 
  Brain, 
  Zap, 
  TrendingUp, 
  Settings, 
  RefreshCw,
  AlertCircle,
  CheckCircle,
  XCircle 
} from 'lucide-react';

interface HammaStats {
  version: number;
  total_contexts: number;
  contexts: ContextStats[];
}

interface ContextStats {
  file_type: string;
  entropy_bucket: number;
  chunk_size_bucket: number;
  shard_id: number;
  dict_id: number;
  strategies: StrategyStats[];
}

interface StrategyStats {
  strategy: string;
  samples: number;
  failures: number;
  fallbacks: number;
  mean_speed_mb_s: number;
  mean_gain: number;
  hard_blacklist: boolean;
}

interface HammaConfig {
  min_speed_mb_s: number;
  min_gain_ratio: number;
  min_samples_for_gating: number;
  state_file: string;
}

export function HammaDashboard() {
  const [stats, setStats] = useState<HammaStats | null>(null);
  const [config, setConfig] = useState<HammaConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [statsRes, configRes] = await Promise.all([
        fetch(`${API_BASE}/hamma/stats`),
        fetch(`${API_BASE}/hamma/config`)
      ]);

      if (!statsRes.ok || !configRes.ok) {
        if (statsRes.status === 503 || configRes.status === 503) {
          setError('HAMMA not initialized. Compress a file first to start learning.');
        } else {
          throw new Error('Failed to fetch HAMMA data');
        }
        return;
      }

      const statsData = await statsRes.json();
      const configData = await configRes.json();

      setStats(statsData);
      setConfig(configData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const resetHamma = async () => {
    alert('Reset functionality requires backend pipeline update. Coming soon!');
    return;
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin h-8 w-8 text-blue-500" />
        <span className="ml-2">Loading HAMMA stats...</span>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  const totalSamples = stats?.contexts.reduce((acc, ctx) => 
    acc + ctx.strategies.reduce((s, st) => s + st.samples, 0), 0
  ) || 0;

  const totalFailures = stats?.contexts.reduce((acc, ctx) => 
    acc + ctx.strategies.reduce((s, st) => s + st.failures, 0), 0
  ) || 0;

  const avgSpeed = stats?.contexts.reduce((acc, ctx) => {
    const ctxSpeed = ctx.strategies.reduce((s, st) => s + st.mean_speed_mb_s, 0);
    return acc + ctxSpeed / Math.max(ctx.strategies.length, 1);
  }, 0) || 0;

  const avgGain = stats?.contexts.reduce((acc, ctx) => {
    const ctxGain = ctx.strategies.reduce((s, st) => s + st.mean_gain, 0);
    return acc + ctxGain / Math.max(ctx.strategies.length, 1);
  }, 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="h-8 w-8 text-purple-500" />
          <div>
            <h2 className="text-2xl font-bold">HAMMA Performance Controller</h2>
            <p className="text-sm text-muted-foreground">
              Self-learning strategy optimization (v{stats?.version})
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchStats} variant="secondary" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button onClick={resetHamma} variant="danger" size="sm">
            Reset
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Contexts</CardTitle>
            <Settings className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats?.total_contexts || 0}</div>
            <p className="text-xs text-muted-foreground">Learning scenarios</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Samples</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSamples.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              {totalFailures} failures ({((totalFailures / Math.max(totalSamples, 1)) * 100).toFixed(1)}%)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Speed</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(avgSpeed / Math.max(stats?.total_contexts || 1, 1)).toFixed(1)} MB/s
            </div>
            <p className="text-xs text-muted-foreground">Across all contexts</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Gain</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(avgGain / Math.max(stats?.total_contexts || 1, 1)).toFixed(2)}x
            </div>
            <p className="text-xs text-muted-foreground">Compression ratio</p>
          </CardContent>
        </Card>
      </div>

      {config && (
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="font-medium">Min Speed:</span>{' '}
                <span className="text-muted-foreground">{config.min_speed_mb_s} MB/s</span>
              </div>
              <div>
                <span className="font-medium">Min Gain:</span>{' '}
                <span className="text-muted-foreground">{config.min_gain_ratio}x</span>
              </div>
              <div>
                <span className="font-medium">Min Samples:</span>{' '}
                <span className="text-muted-foreground">{config.min_samples_for_gating}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Context Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {stats?.contexts.slice(0, 10).map((ctx, idx) => (
              <div key={idx} className="border rounded-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-semibold">{ctx.file_type}</div>
                    <div className="text-xs text-muted-foreground">
                      Entropy: {ctx.entropy_bucket}/10 | 
                      Size: {(ctx.chunk_size_bucket / 1024).toFixed(0)}KB | 
                      Shard: {ctx.shard_id}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {ctx.strategies.map((strat, sidx) => (
                    <div key={sidx} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant={strat.hard_blacklist ? 'destructive' : 'secondary'}>
                          {strat.strategy}
                        </Badge>
                        {strat.hard_blacklist && (
                          <XCircle className="h-4 w-4 text-red-500" />
                        )}
                        {!strat.hard_blacklist && strat.samples > 0 && (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {strat.samples} samples | 
                        {strat.mean_speed_mb_s.toFixed(1)} MB/s | 
                        {strat.mean_gain.toFixed(2)}x gain
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {(stats?.contexts.length || 0) > 10 && (
              <div className="text-center text-sm text-muted-foreground">
                Showing 10 of {stats?.total_contexts} contexts
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
