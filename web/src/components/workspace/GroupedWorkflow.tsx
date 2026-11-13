import { useMemo } from 'react';
import type { Capability, Source } from '../../processing/client';
import { capabilityGroups, planGroupedWorkflow, type ExecutionPlan, type WorkflowSettings } from '../../processing/planner';
import { needsOriginal } from '../../processing/projects';
import { formatFileSize } from '../../utils/fileHelpers';
import { SelectField } from '../ui/SelectField';

export function GroupedWorkflow({ sources, capability, settings, selections, onSelectionsChange, busy, onQualityChange, onRun }: {
  sources: Source[]; capability: Capability; settings: WorkflowSettings; busy: boolean;
  selections: Record<string, string>; onSelectionsChange: (selections: Record<string, string>) => void;
  onQualityChange: (quality: 'lossless' | 'lossy') => void; onRun: (plan: ExecutionPlan) => void;
}) {
  const groups = useMemo(() => capabilityGroups(sources, capability), [sources, capability]);
  const result = useMemo(() => {
    try { return { plan: planGroupedWorkflow(groups, selections, settings, capability), error: '' }; }
    catch (error) { return { plan: undefined, error: error instanceof Error ? error.message : 'This selection could not be planned.' }; }
  }, [groups, selections, settings.qualityMode, settings.metadataPolicy, settings.recursive, capability]);
  if (!groups.length || groups.length < 2 && (!selections[groups[0].id] || selections[groups[0].id] === 'skip')) return null;
  const plan = result.plan;
  const missingOriginal = plan?.groups.some(group => group.sources.some(needsOriginal));
  return <details className="processing-options grouped-workflow">
    <summary>Mixed-file workflow</summary>
    <div className="workflow-groups">{groups.map(group => <label key={group.id}>
      <span>{group.label} <small>({group.sources.length.toLocaleString()})</small></span>
      <SelectField aria-label={`Action for ${group.label}`} disabled={busy} value={group.choices.some(choice => choice.id === selections[group.id]) ? selections[group.id] : 'skip'}
        onChange={value => onSelectionsChange({ ...selections, [group.id]: value })}>
        <option value="skip">Leave selected</option>
        {group.choices.map(choice => <option value={choice.id} key={choice.id}>{choice.label}</option>)}
      </SelectField>
    </label>)}</div>
    {groups.some(group => group.choices.some(choice => choice.operation === 'convert')) && <label className="workflow-quality">Conversion quality
      <SelectField aria-label="Grouped conversion quality" disabled={busy} value={settings.qualityMode} onChange={value => onQualityChange(value as 'lossless' | 'lossy')}>
        <option value="lossless">Lossless</option><option value="lossy">Allow quality loss</option>
      </SelectField>
    </label>}
    {(result.error || !!plan?.issues.length) && <p className="footnote" role="status">{result.error || plan!.issues.join(' ')}</p>}
    {plan && <p className="footnote">Planned: {plan.fileCount.toLocaleString()} {plan.fileCount === 1 ? 'file' : 'files'} in {plan.jobCount.toLocaleString()} {plan.jobCount === 1 ? 'job' : 'jobs'} · estimated upload {formatFileSize(plan.remainingUploadBytes)}{plan.skipped ? ` · ${plan.skipped.toLocaleString()} left selected` : ''}.</p>}
    <button className="button secondary" disabled={busy || !plan?.jobCount || !!plan.issues.length || missingOriginal} onClick={() => plan && onRun(plan)}>Run grouped workflow</button>
    {plan && <p className="footnote">Output limit per job: {formatFileSize(plan.outputLimitPerJob)}. Each archive group is kept together. Other files run independently.</p>}
  </details>;
}
